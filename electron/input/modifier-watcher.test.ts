import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AVOIDANCE_HOLD_DELAY_MS,
  AVOIDANCE_LATCH_TIMEOUT_MS,
  AVOIDANCE_RELEASE_DEBOUNCE_MS,
  ModifierWatcher,
} from "./modifier-watcher.mjs";

let clock = 0;

function createWatcher(overrides = {}) {
  const onPress = vi.fn();
  const onRelease = vi.fn();
  const watcher = new ModifierWatcher({
    platform: "darwin",
    modifier: "meta",
    helperPath: "/fake/mac-modifier-state",
    fileExists: () => true,
    spawnProcess: () => ({ stdout: null, on: vi.fn(), kill: vi.fn() }),
    onPress,
    onRelease,
    logger: { info: vi.fn(), warn: vi.fn() },
    now: () => clock,
    ...overrides,
  });
  return { watcher, onPress, onRelease };
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ModifierWatcher", () => {
  it("fires press only after the hold delay", () => {
    const { watcher, onPress } = createWatcher();

    watcher.handleMask(1);
    vi.advanceTimersByTime(AVOIDANCE_HOLD_DELAY_MS - 20);
    expect(onPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not fire for a quick tap", () => {
    const { watcher, onPress, onRelease } = createWatcher();

    watcher.handleMask(1);
    vi.advanceTimersByTime(20);
    watcher.handleMask(0);
    vi.advanceTimersByTime(400);

    expect(onPress).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("releases after the debounce once the modifier goes up", () => {
    const { watcher, onRelease } = createWatcher();

    watcher.handleMask(1);
    vi.advanceTimersByTime(AVOIDANCE_HOLD_DELAY_MS);
    watcher.handleMask(0);
    vi.advanceTimersByTime(AVOIDANCE_RELEASE_DEBOUNCE_MS - 10);
    expect(onRelease).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("ignores a momentary release blip while the key is still down", () => {
    const { watcher, onPress, onRelease } = createWatcher();

    watcher.handleMask(1);
    vi.advanceTimersByTime(AVOIDANCE_HOLD_DELAY_MS);
    expect(onPress).toHaveBeenCalledTimes(1);

    watcher.handleMask(0);
    vi.advanceTimersByTime(20);
    watcher.handleMask(1);
    vi.advanceTimersByTime(AVOIDANCE_RELEASE_DEBOUNCE_MS * 2);

    expect(onRelease).not.toHaveBeenCalled();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("latches avoidance on a double tap and clears it on the next double tap", () => {
    const { watcher, onPress, onRelease } = createWatcher();

    // 第一次按下并松开: 普通临时避让.
    watcher.handleMask(1);
    vi.advanceTimersByTime(AVOIDANCE_HOLD_DELAY_MS);
    expect(onPress).toHaveBeenCalledTimes(1);
    watcher.handleMask(0);
    vi.advanceTimersByTime(AVOIDANCE_RELEASE_DEBOUNCE_MS);
    expect(onRelease).toHaveBeenCalledTimes(1);

    // 双击: 第二次松开后才确认保持, 留出检测组合键的机会.
    clock += 150;
    watcher.handleMask(1);
    expect(onPress).toHaveBeenCalledTimes(1);
    watcher.handleMask(0);
    expect(onPress).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(AVOIDANCE_RELEASE_DEBOUNCE_MS * 3);
    expect(onRelease).toHaveBeenCalledTimes(1);

    // 再次双击解除保持.
    clock += 400;
    watcher.handleMask(1);
    watcher.handleMask(0);
    clock += 150;
    watcher.handleMask(1);
    expect(onRelease).toHaveBeenCalledTimes(1);
    watcher.handleMask(0);
    expect(onRelease).toHaveBeenCalledTimes(2);
  });

  it("does not latch when the second press is too late", () => {
    const { watcher, onPress } = createWatcher();

    watcher.handleMask(1);
    watcher.handleMask(0);
    clock += 500;
    watcher.handleMask(1);
    vi.advanceTimersByTime(AVOIDANCE_HOLD_DELAY_MS);

    expect(onPress).toHaveBeenCalledTimes(1);
    watcher.handleMask(0);
  });

  it("reverses while the key is held in latch mode", () => {
    const onSuspend = vi.fn();
    const onResume = vi.fn();
    const { watcher } = createWatcher({ onSuspend, onResume });

    watcher.handleMask(1);
    watcher.handleMask(0);
    clock += 150;
    watcher.handleMask(1);
    watcher.handleMask(0);

    // 保持模式下再按住: 反向, 临时取消避让.
    clock += 400;
    watcher.handleMask(1);
    expect(onSuspend).toHaveBeenCalledTimes(1);

    watcher.handleMask(0);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("does not latch when the two presses are on different sides", () => {
    const { watcher, onPress, onRelease } = createWatcher();

    watcher.handleMask(1);
    watcher.handleMask(0);
    clock += 150;
    watcher.handleMask(16);
    vi.advanceTimersByTime(AVOIDANCE_HOLD_DELAY_MS);
    expect(onPress).toHaveBeenCalledTimes(1);

    // 不是保持: 松开后正常恢复.
    watcher.handleMask(0);
    vi.advanceTimersByTime(AVOIDANCE_RELEASE_DEBOUNCE_MS * 2);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("latches when the same side is pressed twice", () => {
    const { watcher, onPress, onRelease } = createWatcher();

    watcher.handleMask(16);
    watcher.handleMask(0);
    clock += 150;
    watcher.handleMask(16);
    expect(onPress).not.toHaveBeenCalled();

    watcher.handleMask(0);
    expect(onPress).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(AVOIDANCE_RELEASE_DEBOUNCE_MS * 2);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("cancels a latch automatically after the timeout", () => {
    const { watcher, onPress, onRelease } = createWatcher();

    watcher.handleMask(1);
    watcher.handleMask(0);
    clock += 150;
    watcher.handleMask(1);
    watcher.handleMask(0);
    expect(onPress).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(AVOIDANCE_LATCH_TIMEOUT_MS - 100);
    expect(onRelease).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("等待第二次松开期间超时, 不会在松开时重新进入保持", () => {
    const { watcher } = createWatcher({ latchTimeoutMs: 250 });
    watcher.handleMask(1);
    watcher.handleMask(0);
    clock = 150;
    watcher.handleMask(1);
    watcher.handleMask(0);
    expect(watcher.latched).toBe(true);
    clock = 400;
    watcher.handleMask(1);
    watcher.handleMask(0);
    vi.advanceTimersByTime(200);
    clock = 550;
    watcher.handleMask(1);
    vi.advanceTimersByTime(50);
    expect(watcher.latched).toBe(false);
    clock = 580;
    watcher.handleMask(0);
    expect(watcher.latched).toBe(false);
  });

  it("keeps the latch forever when the timeout is turned off", () => {
    const { watcher, onPress, onRelease } = createWatcher({ latchTimeoutEnabled: false });

    watcher.handleMask(1);
    watcher.handleMask(0);
    clock += 150;
    watcher.handleMask(1);
    watcher.handleMask(0);
    expect(onPress).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(AVOIDANCE_LATCH_TIMEOUT_MS * 2);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("cancels a pending timeout when the option is turned off", () => {
    const { watcher, onPress, onRelease } = createWatcher();

    watcher.handleMask(1);
    watcher.handleMask(0);
    clock += 150;
    watcher.handleMask(1);
    watcher.handleMask(0);
    expect(onPress).toHaveBeenCalledTimes(1);

    watcher.setLatchTimeout(false);
    vi.advanceTimersByTime(AVOIDANCE_LATCH_TIMEOUT_MS * 2);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("第二次松开前保持有效, 松开后解除且不再触发临时避让", () => {
    const { watcher, onPress, onRelease } = createWatcher();

    watcher.handleMask(1);
    watcher.handleMask(0);
    clock += 150;
    watcher.handleMask(1);
    watcher.handleMask(0);
    expect(onPress).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(AVOIDANCE_RELEASE_DEBOUNCE_MS * 3);
    expect(onRelease).not.toHaveBeenCalled();

    // 第二次按住时仍可成为组合快捷键, 不能提前解除.
    clock += 400;
    watcher.handleMask(1);
    watcher.handleMask(0);
    clock += 150;
    watcher.handleMask(1);
    expect(onRelease).not.toHaveBeenCalled();

    vi.advanceTimersByTime(AVOIDANCE_HOLD_DELAY_MS * 2);
    expect(onPress).toHaveBeenCalledTimes(1);
    watcher.handleMask(0);
    expect(onRelease).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(AVOIDANCE_HOLD_DELAY_MS * 2);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("ignores other modifiers", () => {
    const { watcher, onPress } = createWatcher({ modifier: "alt" });

    watcher.handleMask(1);
    vi.advanceTimersByTime(AVOIDANCE_HOLD_DELAY_MS);

    expect(onPress).not.toHaveBeenCalled();
  });

  it("drops stale press state when the modifier changes", () => {
    const { watcher, onRelease } = createWatcher();

    watcher.handleMask(1);
    vi.advanceTimersByTime(AVOIDANCE_HOLD_DELAY_MS);
    watcher.setModifier("alt");
    vi.advanceTimersByTime(AVOIDANCE_HOLD_DELAY_MS);

    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(watcher.modifier).toBe("alt");
  });

  it("refuses to start without the helper binary", async () => {
    const { watcher } = createWatcher({ fileExists: () => false });

    expect(await watcher.start()).toBe(false);
  });

  it("drives the mask from uiohook key events on Windows", async () => {
    const handlers = {};
    const hook = {
      on: (name, handler) => { handlers[name] = handler; },
      off: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const keycodes = { Meta: 3675, MetaRight: 3676, Alt: 56, AltRight: 3640, Ctrl: 29, CtrlRight: 3613, Shift: 42, ShiftRight: 54 };
    const { watcher, onPress, onRelease } = createWatcher({
      platform: "win32",
      modifier: "alt",
      helperPath: null,
      loadUiohook: async () => ({ uIOhook: hook, UiohookKey: keycodes }),
    });

    expect(await watcher.start()).toBe(true);
    handlers.keydown({ keycode: keycodes.Alt });
    vi.advanceTimersByTime(AVOIDANCE_HOLD_DELAY_MS);
    expect(onPress).toHaveBeenCalledTimes(1);

    handlers.keyup({ keycode: keycodes.Alt });
    vi.advanceTimersByTime(AVOIDANCE_RELEASE_DEBOUNCE_MS);
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(hook.start).toHaveBeenCalledTimes(1);
  });

  describe.each([false, true])("组合键过滤, 初始保持状态 %s", (latched) => {
    it.each([
      { name: "第一次短按中使用普通键", events: [[1000, 1], [1010, 257], [1020, 1], [1030, 0], [1150, 1], [1180, 0]] },
      { name: "第二次短按中使用普通键", events: [[1000, 1], [1030, 0], [1150, 1], [1160, 257], [1170, 1], [1180, 0]] },
      { name: "两次短按之间使用普通键", events: [[1000, 1], [1030, 0], [1050, 256], [1070, 0], [1150, 1], [1180, 0]] },
      { name: "普通键先按住再按修饰键", events: [[990, 256], [1000, 257], [1020, 1], [1030, 0], [1150, 1], [1180, 0]] },
      { name: "第二次短按中加入 Shift", events: [[1000, 1], [1030, 0], [1150, 1], [1160, 9], [1170, 1], [1180, 0]] },
      { name: "两次短按之间使用 Shift", events: [[1000, 1], [1030, 0], [1050, 8], [1070, 0], [1150, 1], [1180, 0]] },
      { name: "两侧 Command 同时按下", events: [[1000, 1], [1030, 0], [1150, 1], [1160, 17], [1170, 1], [1180, 0]] },
      { name: "第二次变成长按", events: [[1000, 1], [1030, 0], [1150, 1], [1500, 0]] },
    ])("$name 不切换保持, 后续独立双击仍有效", ({ events }) => {
      const { watcher, onRelease } = createWatcher({ latchTimeoutEnabled: false });
      if (latched) {
        watcher.handleMask(1);
        watcher.handleMask(0);
        clock = 150;
        watcher.handleMask(1);
        watcher.handleMask(0);
      }
      for (const [at, mask] of events) {
        clock = at;
        watcher.handleMask(mask);
      }
      expect(watcher.latched).toBe(latched);
      expect(onRelease).not.toHaveBeenCalled();
      for (const [at, mask] of [[2000, 1], [2030, 0], [2150, 1], [2180, 0]]) {
        clock = at;
        watcher.handleMask(mask);
      }
      expect(watcher.latched).toBe(!latched);
      watcher.dispose();
    });
  });

  it("macOS helper 的按键计数排除轮询间隙中的短促组合键", async () => {
    const stdout = new PassThrough();
    const { watcher, onRelease } = createWatcher({
      latchTimeoutEnabled: false,
      spawnProcess: () => ({ stdout, on: vi.fn(), kill: vi.fn() }),
    });
    await watcher.start();
    const sample = (at: number, mask: number, count: number) => {
      clock = at;
      stdout.write(`${mask} ${count}\n`);
    };
    stdout.write("p0\n");
    for (const [at, mask] of [[0, 0], [100, 1], [130, 0], [250, 1], [280, 0]]) sample(at, mask, 10);
    expect(watcher.latched).toBe(true);
    sample(1000, 1, 10);
    sample(1030, 0, 10);
    sample(1150, 1, 10);
    // 字母键与第二次 Command 都已经松开, 只有累计事件数发生变化.
    sample(1180, 0, 11);
    expect(watcher.latched).toBe(true);
    expect(onRelease).not.toHaveBeenCalled();
    sample(1300, 1, 11);
    sample(1330, 0, 11);
    expect(watcher.latched).toBe(true);
    watcher.dispose();
    stdout.destroy();
  });

  it("uiohook 排除组合键并区分左右修饰键", async () => {
    const handlers: Record<string, (event: { keycode: number }) => void> = {};
    const hook = { on: (name, handler) => { handlers[name] = handler; }, start() {}, off() {}, stop() {} };
    const { watcher } = createWatcher({
      platform: "win32",
      latchTimeoutEnabled: false,
      loadUiohook: async () => ({ uIOhook: hook, UiohookKey: { Meta: 10, MetaRight: 11, Shift: 12 } }),
    });
    await watcher.start();
    const tap = (at: number, keycode: number) => {
      clock = at;
      handlers.keydown({ keycode });
      clock += 30;
      handlers.keyup({ keycode });
    };
    tap(0, 10);
    tap(150, 11);
    expect(watcher.latched).toBe(false);
    tap(500, 11);
    tap(650, 11);
    expect(watcher.latched).toBe(true);
    tap(1000, 10);
    clock = 1150;
    handlers.keydown({ keycode: 10 });
    handlers.keydown({ keycode: 30 });
    handlers.keydown({ keycode: 31 });
    handlers.keyup({ keycode: 30 });
    handlers.keyup({ keycode: 10 });
    tap(1300, 10);
    expect(watcher.latched).toBe(true);
    handlers.keyup({ keycode: 31 });
    tap(2000, 10);
    tap(2150, 10);
    expect(watcher.latched).toBe(false);
    watcher.dispose();
  });

  it("skips Wayland sessions", async () => {
    const { watcher } = createWatcher({ platform: "linux", wayland: true });

    expect(await watcher.start()).toBe(false);
  });
});
