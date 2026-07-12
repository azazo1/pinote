import { describe, expect, it } from "vitest";
import { ShortcutManager } from "./shortcut-manager.mjs";
import {
  defaultShortcutBindings,
  normalizeAccelerator,
  normalizeShortcutBindings,
  resetShortcutBinding,
  updateShortcutBinding,
} from "./shortcut-settings.mjs";

describe("shortcut settings", () => {
  it("normalizes accelerators and invalid stored bindings", () => {
    expect(normalizeAccelerator("ctrl + shift + k")).toBe("Control+Shift+K");
    expect(normalizeAccelerator("Shift+K")).toBeNull();
    expect(normalizeAccelerator("Control+UnknownKey")).toBeNull();

    const settings = normalizeShortcutBindings({
      "open-main-window": { accelerator: "Ctrl+K", global: true },
      "new-note": { accelerator: "Ctrl+K", global: true },
      "close-window": { accelerator: "invalid", global: true },
    }, "linux");
    expect(settings["open-main-window"]).toEqual({ accelerator: "Control+K", global: true });
    expect(settings["new-note"]).toEqual({ accelerator: "Control+Shift+N", global: true });
    expect(settings["close-window"]).toEqual({ accelerator: "CommandOrControl+W", global: false });
  });

  it("rejects duplicate shortcuts and clears global state", () => {
    const defaults = defaultShortcutBindings("darwin");
    expect(() => updateShortcutBinding(defaults, "sync-now", { accelerator: "Command+N" }, "darwin"))
      .toThrow("快捷键已用于新建便签");
    expect(() => updateShortcutBinding(defaults, "sync-now", { accelerator: "Command+0" }, "darwin"))
      .toThrow("快捷键已用于打开主窗口");

    const global = updateShortcutBinding(defaults, "open-main-window", { global: true }, "darwin");
    const cleared = updateShortcutBinding(global, "open-main-window", { accelerator: null }, "darwin");
    expect(cleared["open-main-window"]).toEqual({ accelerator: null, global: false });
  });

  it("checks conflicts when restoring one shortcut", () => {
    let settings = defaultShortcutBindings("linux");
    settings = updateShortcutBinding(settings, "open-main-window", { accelerator: "Control+K" }, "linux");
    settings = updateShortcutBinding(settings, "sync-now", { accelerator: "CommandOrControl+0" }, "linux");

    expect(() => resetShortcutBinding(settings, "open-main-window", "linux"))
      .toThrow("快捷键已用于立即同步");
  });

  it("rolls back when the system rejects a global shortcut", () => {
    let stored = defaultShortcutBindings("linux");
    const installed: Array<typeof stored> = [];
    const manager = new ShortcutManager({
      platform: "linux",
      getBindings: () => stored,
      saveBindings: (bindings) => { stored = bindings; },
      execute: () => {},
      installMenu: (bindings) => { installed.push(bindings); },
      broadcast: () => { throw new Error("不应广播失败变更"); },
      shortcutApi: {
        register: () => false,
        unregister: () => {},
      },
    });

    expect(() => manager.update("open-main-window", { global: true }))
      .toThrow("系统无法注册此全局快捷键");
    expect(stored["open-main-window"].global).toBe(false);
    expect(installed.at(-1)?.["open-main-window"].global).toBe(false);
  });
});
