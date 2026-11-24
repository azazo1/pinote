import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVOIDANCE_HOLD_DELAY_MS, ModifierWatcher } from "./modifier-watcher.mjs";

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
    ...overrides,
  });
  return { watcher, onPress, onRelease };
}

beforeEach(() => {
  vi.useFakeTimers();
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
    vi.advanceTimersByTime(40);
    watcher.handleMask(0);
    vi.advanceTimersByTime(AVOIDANCE_HOLD_DELAY_MS * 2);

    expect(onPress).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("releases when the modifier goes up", () => {
    const { watcher, onRelease } = createWatcher();

    watcher.handleMask(1);
    vi.advanceTimersByTime(AVOIDANCE_HOLD_DELAY_MS);
    watcher.handleMask(0);

    expect(onRelease).toHaveBeenCalledTimes(1);
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
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(hook.start).toHaveBeenCalledTimes(1);
  });

  it("skips Wayland sessions", async () => {
    const { watcher } = createWatcher({ platform: "linux", wayland: true });

    expect(await watcher.start()).toBe(false);
  });
});
