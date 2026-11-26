#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <unistd.h>

// 状态变化时输出 "位掩码 普通按键事件计数", 不输出普通键的具体键值.
// 1 = 左 Command, 2 = 左 Option, 4 = 左 Control, 8 = 左 Shift,
// 16 = 右 Command, 32 = 右 Option, 64 = 右 Control, 128 = 右 Shift.
//
// 左右分开上报, 是为了让主进程要求"同一侧连续按下两次"才算双击.
// 这里用 CGEventSourceFlagsState 读取修饰键状态: 它不需要输入监控或辅助功能权限,
// 返回值里带 NX_DEVICE* 左右设备位. 如果某个 macOS 版本或键盘不提供设备位,
// 会输出一次 e1, 主进程据此退化为"无法区分左右"并记录日志.
// 不注册 event tap, 也不拦截任何按键.

#define POLL_INTERVAL_MICROS 20000
#define OTHER_KEY_DOWN 256

// 修饰键由设备位单独判断; Caps Lock 和 Fn 也视为其他按键.
static int other_key_down(void) {
    for (CGKeyCode key = 0; key < 128; key++) {
        if (key == 54 || key == 55 || key == 56 || key == 58 || key == 59
            || key == 60 || key == 61 || key == 62) continue;
        if (CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, key)) return 1;
    }
    return 0;
}

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

int main(void) {
    // 输入监控权限预检, 只输出给主进程做日志诊断, 不影响下面的轮询.
    printf("p%d\n", CGPreflightListenEventAccess() ? 1 : 0);
    fflush(stdout);

    int last_mask = -1;
    uint32_t last_key_down_count = 0;
    int device_bits_seen = 0;
    int warned = 0;
    for (;;) {
        CGEventFlags flags = CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState);
        int mask = current_modifier_mask(flags, &device_bits_seen);
        // 按下了修饰键却拿不到任何设备位: 这个系统版本/键盘不支持左右区分.
        if (!device_bits_seen && mask != 0 && !warned) {
            warned = 1;
            printf("e1\n");
            fflush(stdout);
        }
        // 普通按键计数能捕捉轮询间隙内已经完成的短按, 修饰键本身不增加此计数.
        uint32_t key_down_count = CGEventSourceCounterForEventType(
            kCGEventSourceStateCombinedSessionState, kCGEventKeyDown);
        // 只在键盘活动变化或仍有普通键按住时扫描, 避免空闲时反复查询全部键位.
        int other_down = 0;
        if (mask != last_mask || key_down_count != last_key_down_count) {
            other_down = other_key_down();
        }
        if (other_down) mask |= OTHER_KEY_DOWN;
        // 扫描期间发生的普通按键也要随这次状态发送, 在主进程处理松开前排除组合键.
        key_down_count = CGEventSourceCounterForEventType(
            kCGEventSourceStateCombinedSessionState, kCGEventKeyDown);
        if (mask != last_mask || key_down_count != last_key_down_count) {
            last_mask = mask;
            last_key_down_count = key_down_count;
            printf("%d %u\n", mask, key_down_count);
            fflush(stdout);
        }
        usleep(POLL_INTERVAL_MICROS);
    }
    return 0;
}
