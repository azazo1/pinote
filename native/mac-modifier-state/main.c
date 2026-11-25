#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <unistd.h>

// 监听当前按下的修饰键, 只在状态变化时向标准输出写一行位掩码:
// 1 = Command, 2 = Option, 4 = Control, 8 = Shift.
//
// CGEventSourceFlagsState 不需要输入监控或辅助功能权限, 也不注册 event tap;
// 由 Pinote 主进程作为子进程启动, 只用于"按住/双击修饰键让便签避让"这一个交互.

#define POLL_INTERVAL_MICROS 20000

static int current_modifier_mask(void) {
    CGEventFlags flags = CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState);
    int mask = 0;
    if (flags & kCGEventFlagMaskCommand) mask |= 1;
    if (flags & kCGEventFlagMaskAlternate) mask |= 2;
    if (flags & kCGEventFlagMaskControl) mask |= 4;
    if (flags & kCGEventFlagMaskShift) mask |= 8;
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
