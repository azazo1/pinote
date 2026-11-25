#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <unistd.h>

// 监听当前按下的修饰键, 只在状态变化时向标准输出写一行位掩码:
// 1 = 左 Command, 2 = 左 Option, 4 = 左 Control, 8 = 左 Shift,
// 16 = 右 Command, 32 = 右 Option, 64 = 右 Control, 128 = 右 Shift.
//
// 左右分开上报, 是为了让主进程识别"两个同侧键一起按下"的切换手势.
// 这里只读取 CGEventSource 的按键状态, 不注册 event tap, 因此不要求辅助功能权限.
// 由 Pinote 主进程作为子进程启动, 只用于"按住修饰键让便签避让"这一个交互.

#define POLL_INTERVAL_MICROS 20000

// macOS 虚拟键码 (kVK_*), 直接写数值避免依赖 HIToolbox 头文件.
#define KEY_COMMAND 0x37
#define KEY_COMMAND_RIGHT 0x36
#define KEY_SHIFT 0x38
#define KEY_SHIFT_RIGHT 0x3C
#define KEY_CONTROL 0x3B
#define KEY_CONTROL_RIGHT 0x3E
#define KEY_OPTION 0x3A
#define KEY_OPTION_RIGHT 0x3D

static int current_modifier_mask(void) {
    int mask = 0;
    if (CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, KEY_SHIFT)) mask |= 8;
    if (CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, KEY_SHIFT_RIGHT)) mask |= 128;
    if (CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, KEY_CONTROL)) mask |= 4;
    if (CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, KEY_CONTROL_RIGHT)) mask |= 64;
    if (CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, KEY_OPTION)) mask |= 2;
    if (CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, KEY_OPTION_RIGHT)) mask |= 32;
    if (CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, KEY_COMMAND)) mask |= 1;
    if (CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, KEY_COMMAND_RIGHT)) mask |= 16;
    return mask;
}

int main(void) {
    // 输入监控权限预检, 只输出给主进程做日志诊断, 不影响下面的轮询.
    printf("p%d\n", CGPreflightListenEventAccess() ? 1 : 0);
    fflush(stdout);

    int last_mask = -1;
    for (;;) {
        int mask = current_modifier_mask();
        if (mask != last_mask) {
            last_mask = mask;
            printf("%d\n", mask);
            fflush(stdout);
        }
        usleep(POLL_INTERVAL_MICROS);
    }
    return 0;
}
