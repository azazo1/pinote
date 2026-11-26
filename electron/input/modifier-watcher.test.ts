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

    // 双击: 第二次按下落在窗口内, 切换成保持.
    clock += 150;
    watcher.handleMask(1);
    expect(onPress).toHaveBeenCalledTimes(2);
    watcher.handleMask(0);
    vi.advanceTimersByTime(AVOIDANCE_RELEASE_DEBOUNCE_MS * 3);
    expect(onRelease).toHaveBeenCalledTimes(1);

    // 再次双击解除保持.
    clock += 400;
    watcher.handleMask(1);
    watcher.handleMask(0);
    clock += 150;
    watcher.handleMask(1);
    expect(onRelease).toHaveBeenCalledTimes(2);
    watcher.handleMask(0);
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
    expect(onPress).toHaveBeenCalledTimes(1);

    watcher.handleMask(0);
    vi.advanceTimersByTime(AVOIDANCE_RELEASE_DEBOUNCE_MS * 2);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("cancels a latch automatically after the timeout", () => {
    const { watcher, onPress, onRelease } = createWatcher();

    watcher.handleMask(1);
    watcher.handleMask(0);
    clock += 150;
    watcher.handleMask(1);
    expect(onPress).toHaveBeenCalledTimes(1);
    watcher.handleMask(0);

    vi.advanceTimersByTime(AVOIDANCE_LATCH_TIMEOUT_MS - 100);
    expect(onRelease).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("keeps the latch forever when the timeout is turned off", () => {
    const { watcher, onPress, onRelease } = createWatcher({ latchTimeoutEnabled: false });

    watcher.handleMask(1);
    watcher.handleMask(0);
    clock += 150;
    watcher.handleMask(1);
    expect(onPress).toHaveBeenCalledTimes(1);
    watcher.handleMask(0);

    vi.advanceTimersByTime(AVOIDANCE_LATCH_TIMEOUT_MS * 2);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("cancels a pending timeout when the option is turned off", () => {
    const { watcher, onPress, onRelease } = createWatcher();

    watcher.handleMask(1);
    watcher.handleMask(0);
    clock += 150;
    watcher.handleMask(1);
    expect(onPress).toHaveBeenCalledTimes(1);
    watcher.handleMask(0);

    watcher.setLatchTimeout(false);
    vi.advanceTimersByTime(AVOIDANCE_LATCH_TIMEOUT_MS * 2);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("does not re-trigger after clearing the latch while the key is still held", () => {
    const { watcher, onPress, onRelease } = createWatcher();

    watcher.handleMask(1);
    watcher.handleMask(0);
    clock += 150;
    watcher.handleMask(1);
    expect(onPress).toHaveBeenCalledTimes(1);
    watcher.handleMask(0);
    vi.advanceTimersByTime(AVOIDANCE_RELEASE_DEBOUNCE_MS * 3);
    expect(onRelease).not.toHaveBeenCalled();

    // 双击解除, 解除瞬间按键仍然按着.
    clock += 400;
    watcher.handleMask(1);
    watcher.handleMask(0);
    clock += 150;
    watcher.handleMask(1);
    expect(onRelease).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(AVOIDANCE_HOLD_DELAY_MS * 2);
    expect(onPress).toHaveBeenCalledTimes(1);
    watcher.handleMask(0);
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

  it("skips Wayland sessions", async () => {
    const { watcher } = createWatcher({ platform: "linux", wayland: true });

    expect(await watcher.start()).toBe(false);
  });
});
