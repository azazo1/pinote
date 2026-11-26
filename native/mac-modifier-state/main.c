#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

// 监听修饰键与文本插入点, 只在状态变化时向标准输出写一行:
// 1 = 左 Command, 2 = 左 Option, 4 = 左 Control, 8 = 左 Shift,
// 16 = 右 Command, 32 = 右 Option, 64 = 右 Control, 128 = 右 Shift.
//
// 修饰键用 CGEventSourceFlagsState 读取 (不需要权限), 返回值里的 NX_DEVICE*
// 设备位用来区分左右. 某个系统版本或键盘不提供设备位时输出一次 e1.
//
// 文本插入点 (caret) 需要辅助功能权限: 用 AXUIElement 查询系统焦点元素的
// 选区范围, 再取该范围的屏幕矩形. 授权状态输出 a0/a1; 光标矩形输出
// c<x>,<y>,<w>,<h>; 读不到时输出 c. 未授权时不查询, 只输出 a0.
// 不注册 event tap, 也不拦截任何按键.

#define POLL_INTERVAL_MICROS 20000
#define AX_POLL_EVERY 5

// CGEventFlags 里的左右设备位 (来自 IOLLEvent.h 的 NX_DEVICE*KEYMASK).
#define NX_DEVICELCTLKEYMASK 0x00000001
#define NX_DEVICELSHIFTKEYMASK 0x00000002
#define NX_DEVICERSHIFTKEYMASK 0x00000004
#define NX_DEVICELCMDKEYMASK 0x00000008
#define NX_DEVICERCMDKEYMASK 0x00000010
#define NX_DEVICELALTKEYMASK 0x00000020
#define NX_DEVICERALTKEYMASK 0x00000040
#define NX_DEVICERCTLKEYMASK 0x00002000

static int current_modifier_mask(CGEventFlags flags, int *device_bits_seen) {
    int mask = 0;
    if (flags & NX_DEVICELSHIFTKEYMASK) mask |= 8;
    if (flags & NX_DEVICERSHIFTKEYMASK) mask |= 128;
    if (flags & NX_DEVICELCTLKEYMASK) mask |= 4;
    if (flags & NX_DEVICERCTLKEYMASK) mask |= 64;
    if (flags & NX_DEVICELALTKEYMASK) mask |= 2;
    if (flags & NX_DEVICERALTKEYMASK) mask |= 32;
    if (flags & NX_DEVICELCMDKEYMASK) mask |= 1;
    if (flags & NX_DEVICERCMDKEYMASK) mask |= 16;
    if (mask != 0) *device_bits_seen = 1;
    // 设备位不可用时退回通用位, 此时只能判断"某一侧按下", 无法区分左右.
    if (mask == 0) {
        if (flags & kCGEventFlagMaskShift) mask |= 8;
        if (flags & kCGEventFlagMaskControl) mask |= 4;
        if (flags & kCGEventFlagMaskAlternate) mask |= 2;
        if (flags & kCGEventFlagMaskCommand) mask |= 1;
    }
    return mask;
}

typedef struct {
    int has_caret;
    int x;
    int y;
    int w;
    int h;
} CaretRect;

// 读取系统焦点元素里选区范围的屏幕矩形; 失败时返回 0.
static int read_caret(CaretRect *out) {
    AXUIElementRef system = AXUIElementCreateSystemWide();
    if (system == NULL) return 0;
    CFTypeRef focused = NULL;
    int ok = 0;
    if (AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute, &focused) == kAXErrorSuccess && focused != NULL) {
        CFTypeRef range = NULL;
        if (AXUIElementCopyAttributeValue((AXUIElementRef)focused, kAXSelectedTextRangeAttribute, &range) == kAXErrorSuccess && range != NULL) {
            CFTypeRef bounds = NULL;
            if (AXUIElementCopyParameterizedAttributeValue((AXUIElementRef)focused, kAXBoundsForRangeParameterizedAttribute, range, &bounds) == kAXErrorSuccess && bounds != NULL) {
                CGRect rect;
                if (AXValueGetValue((AXValueRef)bounds, kAXValueCGRectType, &rect)) {
                    // 部分应用对插入点返回零宽/零高矩形, 仍保留位置, 高度用 1 兜底.
                    if (rect.size.width >= 0 && rect.origin.x > -100000 && rect.origin.y > -100000) {
                        out->has_caret = 1;
                        out->x = (int)llround(rect.origin.x);
                        out->y = (int)llround(rect.origin.y);
                        out->w = (int)llround(rect.size.width);
                        out->h = (int)llround(rect.size.height);
                        ok = 1;
                    }
                }
                CFRelease(bounds);
            }
            CFRelease(range);
        }
        CFRelease(focused);
    }
    CFRelease(system);
    return ok;
}

int main(void) {
    // 输入监控权限预检, 只输出给主进程做日志诊断, 不影响下面的轮询.
    printf("p%d\n", CGPreflightListenEventAccess() ? 1 : 0);
    fflush(stdout);

    int last_mask = -1;
    int device_bits_seen = 0;
    int warned = 0;
    int last_ax = -1;
    CaretRect last_caret = { 0, 0, 0, 0, 0 };
    for (long frame = 1;; frame++) {
        CGEventFlags flags = CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState);
        int mask = current_modifier_mask(flags, &device_bits_seen);
        if (!device_bits_seen && mask != 0 && !warned) {
            warned = 1;
            printf("e1\n");
            fflush(stdout);
        }
        if (mask != last_mask) {
            last_mask = mask;
            printf("%d\n", mask);
            fflush(stdout);
        }

        if (frame % AX_POLL_EVERY == 0) {
            int trusted = AXIsProcessTrusted() ? 1 : 0;
            if (trusted != last_ax) {
                last_ax = trusted;
                printf("a%d\n", trusted);
                fflush(stdout);
            }
            if (trusted) {
                CaretRect caret;
                memset(&caret, 0, sizeof(caret));
                if (read_caret(&caret)) {
                    if (!last_caret.has_caret || last_caret.x != caret.x || last_caret.y != caret.y
                        || last_caret.w != caret.w || last_caret.h != caret.h) {
                        last_caret = caret;
                        printf("c%d,%d,%d,%d\n", caret.x, caret.y, caret.w, caret.h);
                        fflush(stdout);
                    }
                } else if (last_caret.has_caret) {
                    last_caret.has_caret = 0;
                    printf("c\n");
                    fflush(stdout);
                }
            } else if (last_caret.has_caret) {
                last_caret.has_caret = 0;
                printf("c\n");
                fflush(stdout);
            }
        }

        usleep(POLL_INTERVAL_MICROS);
    }
    return 0;
}
