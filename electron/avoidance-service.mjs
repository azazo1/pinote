import {
  AVOIDANCE_STAGGER_MS,
  avoidanceExitBounds,
  avoidanceExitDuration,
  avoidanceReturnDuration,
  boundsDistance,
  easeInQuad,
  easeOutCubic,
  isAvoidanceTarget,
} from "./windowing/avoidance.mjs";

const FRAME_MS = 16;
const AVOIDANCE_CHANNEL = "avoidance:state";
// 恢复动画的最后兜底, 防止某张便签的动画因异常停在屏幕外.
const RESTORE_FALLBACK_MARGIN_MS = 400;

// 便签避让: 按住修饰键时, 鼠标附近的便签依次飘出屏幕; 松开后按记录的原位精确回位.
// 窗口位置只在内存中记录, 避让全程不写回配置, 因此不会污染便签的真实位置.
export class AvoidanceService {
  constructor({
    getTargets,
    workAreaFor,
    logger = { info() {}, warn() {} },
    now = () => performance.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    this.getTargets = getTargets ?? (() => []);
    this.workAreaFor = workAreaFor ?? (() => ({ x: 0, y: 0, width: 0, height: 0 }));
    this.logger = logger;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.phase = "idle";
    this.entries = new Map();
    this.fallbackTimer = null;
  }

  isActive() {
    return this.phase !== "idle";
  }

  // 便签是否正处于避让托管中, 用于阻止把避让位置写回持久化状态.
  isTracking(window) {
    if (!window || this.phase === "idle") return false;
    for (const entry of this.entries.values()) {
      if (entry.window === window) return true;
    }
    return false;
  }

  begin(pointer) {
    if (!Number.isFinite(pointer?.x) || !Number.isFinite(pointer?.y)) return false;
    if (this.phase === "escaping") return false;
    this.cancelFallback();

    if (this.phase === "restoring") {
      // 返回途中再次按住: 保留每张便签的原位, 从当前位置重新飘走.
      const entries = [...this.entries.values()];
      for (const entry of entries) this.clearEntryTimers(entry);
      if (entries.length === 0) {
        this.phase = "idle";
        return false;
      }
      this.phase = "escaping";
      this.launchEscape(entries, pointer);
      return true;
    }

    const near = [];
    for (const target of this.getTargets()) {
      const { key, window } = target ?? {};
      if (!key || !window || window.isDestroyed?.() || !isVisible(window)) continue;
      if (!isAvoidanceTarget(pointer, window.getBounds())) continue;
      near.push({ key, window });
    }
    if (near.length === 0) return false;
    near.sort((left, right) => boundsDistance(left.window.getBounds(), centerBounds(pointer))
      - boundsDistance(right.window.getBounds(), centerBounds(pointer)));

    this.entries.clear();
    for (const { key, window } of near) {
      this.entries.set(key, {
        key,
        window,
        origin: window.getBounds(),
        startTimer: null,
        frame: null,
      });
    }
    this.phase = "escaping";
    this.launchEscape([...this.entries.values()], pointer);
    this.logger.info("便签开始避让", { count: this.entries.size });
    return true;
  }

  finish() {
    if (this.phase !== "escaping") return false;
    this.phase = "restoring";
    const entries = [...this.entries.values()];
    let longest = 0;
    entries.forEach((entry, index) => {
      this.clearEntryTimers(entry);
      entry.startTimer = this.setTimer(() => {
        entry.startTimer = null;
        if (this.phase !== "restoring") return;
        this.restoreEntry(entry, index);
      }, index * AVOIDANCE_STAGGER_MS);
      longest = Math.max(longest, index * AVOIDANCE_STAGGER_MS);
    });
    this.armFallback(longest);
    this.logger.info("便签正在回到原位", { count: entries.length });
    return entries.length > 0;
  }

  // 窗口被关闭/销毁时调用, 避免继续托管一个不存在的窗口.
  forget(window) {
    for (const [key, entry] of this.entries) {
      if (entry.window !== window) continue;
      this.clearEntryTimers(entry);
      this.entries.delete(key);
    }
    if (this.entries.size === 0 && this.phase !== "idle") {
      this.phase = "idle";
      this.cancelFallback();
    }
  }

  // 退出或被禁用时立刻还原, 不做动画.
  dispose() {
    this.cancelFallback();
    for (const entry of this.entries.values()) {
      this.clearEntryTimers(entry);
      const { window, origin } = entry;
      if (!window || window.isDestroyed?.()) continue;
      window.setBounds?.(origin, false);
      window.setIgnoreMouseEvents?.(false);
      sendAvoiding(window, false);
    }
    this.entries.clear();
    this.phase = "idle";
  }

  launchEscape(entries, pointer) {
    const center = centerBounds(pointer);
    const ordered = [...entries].sort((left, right) => boundsDistance(left.window.getBounds(), center)
      - boundsDistance(right.window.getBounds(), center));
    ordered.forEach((entry, index) => {
      entry.startTimer = this.setTimer(() => {
        entry.startTimer = null;
        if (this.phase !== "escaping") return;
        const window = entry.window;
        if (window.isDestroyed?.() || !isVisible(window)) {
          this.entries.delete(entry.key);
          if (this.entries.size === 0) this.phase = "idle";
          return;
        }
        // 落位前先让鼠标穿透, 移动途中也不会误点便签或抢焦点.
        window.setIgnoreMouseEvents?.(true);
        sendAvoiding(window, true);
        const from = window.getBounds();
        const to = avoidanceExitBounds(from, this.workAreaFor(from));
        this.animateEntry(entry, from, to, avoidanceExitDuration(from, to), easeInQuad);
      }, index * AVOIDANCE_STAGGER_MS);
    });
  }

  restoreEntry(entry) {
    const window = entry.window;
    if (window.isDestroyed?.()) {
      this.entries.delete(entry.key);
      this.finishIfIdle();
      return;
    }
    const from = window.getBounds();
    const to = entry.origin;
    sendAvoiding(window, false);
    this.animateEntry(entry, from, to, avoidanceReturnDuration(from, to), easeOutCubic, () => {
      window.setBounds?.(to, false);
      window.setIgnoreMouseEvents?.(false);
      this.entries.delete(entry.key);
      this.finishIfIdle();
    });
  }

  animateEntry(entry, from, to, duration, easing, onDone) {
    const startedAt = this.now();
    const tick = () => {
      const window = entry.window;
      if (window.isDestroyed?.() || this.entries.get(entry.key) !== entry) {
        entry.frame = null;
        return;
      }
      const progress = duration <= 0 ? 1 : Math.min(1, (this.now() - startedAt) / duration);
      const eased = easing(progress);
      window.setBounds(interpolateBounds(from, to, eased), false);
      if (progress < 1) {
        entry.frame = this.setTimer(tick, FRAME_MS);
        return;
      }
      entry.frame = null;
      onDone?.();
    };
    tick();
  }

  finishIfIdle() {
    if (this.entries.size > 0 || this.phase === "idle") return;
    this.phase = "idle";
    this.cancelFallback();
    this.logger.info("便签已全部回到原位");
  }

  armFallback(staggerMs) {
    this.cancelFallback();
    this.fallbackTimer = this.setTimer(() => {
      this.fallbackTimer = null;
      if (this.phase === "idle") return;
      this.logger.warn("便签回到原位的动画超时, 强制还原", { count: this.entries.size });
      for (const entry of this.entries.values()) {
        this.clearEntryTimers(entry);
        const { window, origin } = entry;
        if (!window || window.isDestroyed?.()) continue;
        window.setBounds?.(origin, false);
        window.setIgnoreMouseEvents?.(false);
        sendAvoiding(window, false);
      }
      this.entries.clear();
      this.phase = "idle";
    }, staggerMs + AVOIDANCE_STAGGER_MS + 900 + RESTORE_FALLBACK_MARGIN_MS);
  }

  cancelFallback() {
    if (this.fallbackTimer === null) return;
    this.clearTimer(this.fallbackTimer);
    this.fallbackTimer = null;
  }

  clearEntryTimers(entry) {
    if (entry.startTimer !== null) {
      this.clearTimer(entry.startTimer);
      entry.startTimer = null;
    }
    if (entry.frame !== null) {
      this.clearTimer(entry.frame);
      entry.frame = null;
    }
  }
}

function sendAvoiding(window, avoiding) {
  if (!window?.webContents || window.webContents.isDestroyed?.()) return;
  window.webContents.send(AVOIDANCE_CHANNEL, Boolean(avoiding));
}

function isVisible(window) {
  return typeof window.isVisible === "function" ? window.isVisible() : true;
}

function centerBounds(point) {
  return { x: point.x, y: point.y, width: 0, height: 0 };
}

function interpolateBounds(start, target, progress) {
  return {
    x: Math.round(start.x + (target.x - start.x) * progress),
    y: Math.round(start.y + (target.y - start.y) * progress),
    width: Math.round(start.width + (target.width - start.width) * progress),
    height: Math.round(start.height + (target.height - start.height) * progress),
  };
}
