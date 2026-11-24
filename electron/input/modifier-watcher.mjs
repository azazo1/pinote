import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import readline from "node:readline";
import {
  AVOIDANCE_MODIFIER_BITS,
  avoidanceModifierLabel,
  normalizeAvoidanceModifier,
} from "../avoidance-settings.mjs";

// 按住多久才算真的想避让, 过滤掉 Cmd + C 这类快速组合键造成的闪烁.
export const AVOIDANCE_HOLD_DELAY_MS = 110;

// 监听"按住某个修饰键"的后端:
// - macOS: 常驻 native/mac-modifier-state 子进程轮询修饰键状态, 只读状态, 不需要辅助功能权限.
// - Windows / Linux: 用 uiohook 的全局键盘钩子, 系统不需要额外授权.
// 两种后端都只上报修饰键位掩码, 不拦截按键, 也不改变焦点.
export class ModifierWatcher {
  constructor({
    platform = process.platform,
    wayland = false,
    modifier,
    helperPath = null,
    onPress,
    onRelease,
    logger = { info() {}, warn() {} },
    holdDelayMs = AVOIDANCE_HOLD_DELAY_MS,
    spawnProcess = spawn,
    fileExists = existsSync,
    loadUiohook = () => import("uiohook-napi"),
  } = {}) {
    this.platform = platform;
    this.wayland = wayland;
    this.modifier = normalizeAvoidanceModifier(modifier, platform);
    this.helperPath = helperPath;
    this.onPress = onPress;
    this.onRelease = onRelease;
    this.logger = logger;
    this.holdDelayMs = holdDelayMs;
    this.spawnProcess = spawnProcess;
    this.fileExists = fileExists;
    this.loadUiohook = loadUiohook;
    this.child = null;
    this.reader = null;
    this.uiohook = null;
    this.keycodeMap = null;
    this.mask = 0;
    this.pressed = false;
    this.holdTimer = null;
    this.fired = false;
    this.started = false;
    this.disposed = false;
    this.inputMonitoringGranted = null;
  }

  get modifierLabel() {
    return avoidanceModifierLabel(this.modifier, this.platform);
  }

  get holdBit() {
    return AVOIDANCE_MODIFIER_BITS[this.modifier] ?? 0;
  }

  async start() {
    if (this.started) return true;
    if (this.platform === "linux" && this.wayland) {
      this.logger.info("Wayland 会话不支持全局按键监听, 已跳过便签避让");
      return false;
    }
    const started = this.platform === "darwin" ? this.startPoller() : await this.startUiohook();
    this.started = started;
    if (started) {
      this.logger.info("便签避让按键监听已启动", {
        platform: this.platform,
        modifier: this.modifierLabel,
        backend: this.platform === "darwin" ? "poller" : "uiohook",
      });
    }
    return started;
  }

  setModifier(modifier) {
    const next = normalizeAvoidanceModifier(modifier, this.platform);
    if (next === this.modifier) return;
    this.modifier = next;
    // 换键时清掉旧按键的按下状态, 避免残留一次"按住"状态.
    this.pressed = false;
    this.releaseHold();
    this.logger.info("便签避让按键已切换", { modifier: this.modifierLabel });
  }

  dispose() {
    this.disposed = true;
    this.cancelHold();
    this.pressed = false;
    this.fired = false;
    const reader = this.reader;
    this.reader = null;
    try {
      reader?.close?.();
    } catch {
      // 关闭读取流失败不影响退出.
    }
    const child = this.child;
    this.child = null;
    if (child) {
      try {
        child.kill?.();
      } catch {
        // 子进程可能已退出.
      }
    }
    const uiohook = this.uiohook;
    this.uiohook = null;
    if (uiohook) {
      try {
        uiohook.off?.("keydown", this.handleHookKeyDown);
        uiohook.off?.("keyup", this.handleHookKeyUp);
        uiohook.stop?.();
      } catch (error) {
        this.logger.warn("停止便签避让按键监听失败", {
          message: error instanceof Error ? error.message : "未知错误",
        });
      }
    }
    this.started = false;
  }

  startPoller() {
    if (!this.helperPath || !this.fileExists(this.helperPath)) {
      this.logger.warn("未找到便签避让 helper, 请先运行 bun run native");
      return false;
    }
    try {
      const child = this.spawnProcess(this.helperPath, [], { stdio: ["ignore", "pipe", "ignore"] });
      this.child = child;
      this.reader = readline.createInterface({ input: child.stdout });
      this.reader.on("line", (line) => {
        const text = String(line).trim();
        if (text.startsWith("p")) {
          // helper 的权限预检: p1 表示已授予输入监控, p0 表示未授予.
          this.inputMonitoringGranted = text === "p1";
          if (!this.inputMonitoringGranted) {
            this.logger.warn("输入监控权限预检未通过; 若按住避让键没有反应, 请到 系统设置 > 隐私与安全性 > 输入监控 允许 Pinote");
          }
          return;
        }
        const mask = Number.parseInt(text, 10);
        if (Number.isFinite(mask)) this.handleMask(mask);
      });
      child.on("error", (error) => {
        this.logger.warn("便签避让 helper 运行失败", { message: errorMessage(error) });
      });
      child.on("exit", (code, signal) => {
        this.child = null;
        try {
          this.reader?.close?.();
        } catch {
          // 退出时读取流可能已关闭.
        }
        this.reader = null;
        if (this.disposed) return;
        this.started = false;
        this.releaseHold();
        this.logger.warn("便签避让 helper 已退出", { code, signal });
      });
      return true;
    } catch (error) {
      this.logger.warn("启动便签避让 helper 失败", { message: errorMessage(error) });
      return false;
    }
  }

  async startUiohook() {
    try {
      const loaded = await this.loadUiohook();
      const uiohook = loaded?.uIOhook ?? loaded?.default?.uIOhook;
      const keycodes = loaded?.UiohookKey ?? loaded?.default?.UiohookKey;
      if (!uiohook || !keycodes) throw new Error("uiohook 模块缺少导出");
      this.keycodeMap = buildKeycodeMap(keycodes);
      if (this.keycodeMap.size === 0) throw new Error("修饰键码不可用");
      this.mask = 0;
      uiohook.on("keydown", this.handleHookKeyDown);
      uiohook.on("keyup", this.handleHookKeyUp);
      uiohook.start();
      this.uiohook = uiohook;
      return true;
    } catch (error) {
      this.logger.warn("便签避让按键监听不可用", { platform: this.platform, message: errorMessage(error) });
      return false;
    }
  }

  handleHookKeyDown = (event) => {
    const bit = this.keycodeMap?.get(event?.keycode);
    if (!bit || (this.mask & bit) !== 0) return;
    this.mask |= bit;
    this.handleMask(this.mask);
  };

  handleHookKeyUp = (event) => {
    const bit = this.keycodeMap?.get(event?.keycode);
    if (!bit) return;
    this.mask &= ~bit;
    this.handleMask(this.mask);
  };

  handleMask(mask) {
    if (this.disposed) return;
    const down = (mask & this.holdBit) !== 0;
    if (down === this.pressed) return;
    this.pressed = down;
    if (down) this.schedulePress();
    else this.releaseHold();
  }

  schedulePress() {
    this.cancelHold();
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      if (!this.pressed || this.fired || this.disposed) return;
      this.fired = true;
      this.onPress?.();
    }, this.holdDelayMs);
  }

  releaseHold() {
    this.cancelHold();
    if (!this.fired) return;
    this.fired = false;
    this.onRelease?.();
  }

  cancelHold() {
    if (this.holdTimer === null) return;
    clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }
}

function buildKeycodeMap(keys) {
  const map = new Map();
  const pairs = [
    [keys.Meta, 1],
    [keys.MetaRight, 1],
    [keys.Alt, 2],
    [keys.AltRight, 2],
    [keys.Ctrl, 4],
    [keys.CtrlRight, 4],
    [keys.Shift, 8],
    [keys.ShiftRight, 8],
  ];
  for (const [code, bit] of pairs) {
    if (Number.isFinite(code)) map.set(code, bit);
  }
  return map;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "未知错误";
}
