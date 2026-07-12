import { globalShortcut } from "electron";
import log from "electron-log/main.js";
import {
  defaultShortcutBindings,
  normalizeShortcutBindings,
  resetShortcutBinding,
  SHORTCUT_COMMANDS,
  updateShortcutBinding,
} from "./shortcut-settings.mjs";

export class ShortcutManager {
  constructor({ platform, getBindings, saveBindings, execute, installMenu, broadcast, shortcutApi = globalShortcut }) {
    this.platform = platform;
    this.getBindings = getBindings;
    this.saveBindings = saveBindings;
    this.execute = execute;
    this.installMenu = installMenu;
    this.broadcast = broadcast;
    this.shortcutApi = shortcutApi;
    this.registered = new Map();
  }

  initialize() {
    const current = normalizeShortcutBindings(this.getBindings(), this.platform);
    const active = structuredClone(current);
    for (const command of SHORTCUT_COMMANDS) {
      const binding = active[command.id];
      if (!binding.global || !binding.accelerator) continue;
      if (this.register(command.id, binding.accelerator)) continue;
      active[command.id] = { ...binding, global: false };
      log.warn("恢复全局快捷键失败, 已关闭全局监听", { id: command.id, accelerator: binding.accelerator });
    }
    this.installMenu(active);
    if (!equalBindings(active, current)) this.saveBindings(active);
    return active;
  }

  update(id, patch) {
    const current = normalizeShortcutBindings(this.getBindings(), this.platform);
    const candidate = updateShortcutBinding(current, id, patch, this.platform);
    return this.apply(current, candidate, `快捷键已更新: ${id}`);
  }

  reset(id) {
    const current = normalizeShortcutBindings(this.getBindings(), this.platform);
    const candidate = resetShortcutBinding(current, id, this.platform);
    return this.apply(current, candidate, `快捷键已恢复默认: ${id}`);
  }

  resetAll() {
    const current = normalizeShortcutBindings(this.getBindings(), this.platform);
    const candidate = defaultShortcutBindings(this.platform);
    return this.apply(current, candidate, "全部快捷键已恢复默认");
  }

  dispose() {
    this.unregisterCurrent();
  }

  apply(current, candidate, message) {
    this.unregisterCurrent();
    try {
      this.registerAll(candidate);
      this.installMenu(candidate);
    } catch (error) {
      this.unregisterCurrent();
      try {
        this.registerAll(current);
        this.installMenu(current);
      } catch (rollbackError) {
        log.error("恢复快捷键运行状态失败", rollbackError);
      }
      throw error;
    }
    this.saveBindings(candidate);
    this.broadcast(candidate);
    log.info(message);
    return candidate;
  }

  registerAll(bindings) {
    for (const command of SHORTCUT_COMMANDS) {
      const binding = bindings[command.id];
      if (!binding.global || !binding.accelerator) continue;
      if (!this.register(command.id, binding.accelerator)) {
        log.warn("注册全局快捷键失败", { id: command.id, accelerator: binding.accelerator });
        throw new Error("系统无法注册此全局快捷键");
      }
    }
  }

  register(id, accelerator) {
    let registered = false;
    try {
      registered = this.shortcutApi.register(accelerator, () => this.execute(id));
    } catch (error) {
      log.warn("全局快捷键格式无效", { id, accelerator, message: error instanceof Error ? error.message : "未知错误" });
      return false;
    }
    if (registered) this.registered.set(id, accelerator);
    return registered;
  }

  unregisterCurrent() {
    for (const accelerator of this.registered.values()) this.shortcutApi.unregister(accelerator);
    this.registered.clear();
  }
}

function equalBindings(left, right) {
  return SHORTCUT_COMMANDS.every(({ id }) => (
    left[id].accelerator === right[id].accelerator && left[id].global === right[id].global
  ));
}
