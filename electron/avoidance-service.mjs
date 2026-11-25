import {
  AVOIDANCE_FOLLOW_MS,
  AVOIDANCE_RELEASE_MARGIN,
  AVOIDANCE_SMOOTH_TAU_MS,
  approachBounds,
  avoidanceField,
  avoidancePushCandidates,
  boundsSettled,
  rectIntersectsCircle,
} from "./windowing/avoidance.mjs";

// 松开后的还原超时: 万一某个窗口卡住, 直接吸附回原位.
const SETTLE_TIMEOUT_MS = 1_500;

// 便签避让: 按住修饰键时形成一个跟着鼠标走的圆形立场, 与立场相交的便签被推开;
// 鼠标继续追, 便签就继续让; 鼠标离开后回到原位. 松开修饰键后全部回原位.
// 窗口位置只在内存中记录, 避让全程不写回配置.
export class AvoidanceService {
  constructor({
    getTargets,
    getCursor,
    getFocusedWindow = () => null,
    logger = { info() {}, warn() {} },
    smoothTauMs = AVOIDANCE_SMOOTH_TAU_MS,
    followMs = AVOIDANCE_FOLLOW_MS,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    now = () => performance.now(),
  } = {}) {
    this.getTargets = getTargets ?? (() => []);
    this.getCursor = getCursor ?? (() => null);
    this.getFocusedWindow = getFocusedWindow;
    this.logger = logger;
    this.smoothTauMs = smoothTauMs;
    this.followMs = followMs;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.now = now;
    this.phase = "idle";
    this.entries = new Map();
    this.excluded = new Set();
    this.loopTimer = null;
    this.settleDeadline = 0;
    this.lastTickAt = null;
  }

  isActive() {
    return this.phase !== "idle";
  }

  isTracking(window) {
    if (!window || this.phase === "idle") return false;
    for (const entry of this.entries.values()) {
      if (entry.window === window) return true;
    }
    return false;
  }

  // 进入立场模式: 记住所有可避让便签的当前位置, 之后跟着鼠标实时推开.
  start() {
    if (this.phase === "field") return false;
    this.phase = "field";
    this.excluded.clear();
    this.trackTargets();
    if (this.entries.size === 0) {
      this.phase = "idle";
      return false;
    }
    this.lastTickAt = null;
    this.ensureLoop();
    this.logger.info("便签避让立场已开启", { count: this.entries.size });
    return true;
  }

  // 松开修饰键: 所有便签回到原位, 平滑结束后退出.
  finish() {
    if (this.phase !== "field") return false;
    this.phase = "returning";
    this.settleDeadline = this.now() + SETTLE_TIMEOUT_MS;
    this.logger.info("便签正在回到原位", { count: this.entries.size });
    return true;
  }

  forget(window) {
    for (const [key, entry] of this.entries) {
      if (entry.window !== window) continue;
      this.entries.delete(key);
    }
    if (this.entries.size === 0 && this.phase !== "idle") this.exit();
  }

  // 退出或被禁用时立刻还原, 不做动画.
  dispose() {
    this.snapToOrigins();
    this.exit();
  }

  tick() {
    if (this.phase === "idle") {
      this.stopLoop();
      return;
    }
    if (this.phase === "field") this.trackTargets();

    const nowMs = this.now();
    const elapsed = this.lastTickAt === null ? this.followMs : Math.max(1, nowMs - this.lastTickAt);
    this.lastTickAt = nowMs;
    // 与帧率无关的指数靠近: 60Hz 和 30Hz 下移动速度一致.
    const factor = 1 - Math.exp(-Math.min(elapsed, 64) / this.smoothTauMs);
    const field = this.phase === "field" ? avoidanceField(this.getCursor()) : null;
    const focused = this.getFocusedWindow() ?? null;
    let moving = false;

    for (const entry of [...this.entries.values()]) {
      const { window } = entry;
      if (window.isDestroyed?.()) {
        this.entries.delete(entry.key);
        continue;
      }
      // 托管期间便签被点中(获得焦点): 立刻放它回原位并退出托管, 避免和收起/展开等操作抢窗口尺寸.
      if (focused && window === focused) {
        this.releaseEntry(entry);
        continue;
      }
      const current = window.getBounds();
      const target = this.targetFor(entry, current, field);
      const settled = boundsSettled(current, target);
      const interactive = settled && isSamePosition(target, entry.origin);
      this.setInteractive(entry, interactive);

      if (settled) {
        if (!isSamePosition(current, target)) window.setBounds?.(target, false);
        continue;
      }
      const next = approachBounds(current, target, factor);
      if (isSamePosition(next, current)) continue;
      moving = true;
      window.setBounds?.(next, false);
    }

    if (this.phase === "returning") {
      const overdue = nowMs >= this.settleDeadline;
      if (!moving || overdue) {
        this.snapToOrigins();
        this.exit();
      }
    }
  }

  // 目标位置: 始终按"原位"算出立场外的最小旁位, 不按当前位置累加, 因此不会一路往下推.
  targetFor(entry, current, field) {
    if (this.phase !== "field" || !field) return entry.origin;
    const releaseCircle = { ...field, radius: field.radius + AVOIDANCE_RELEASE_MARGIN };
    const originBlocked = rectIntersectsCircle(entry.origin, field);
    const currentBlocked = rectIntersectsCircle(current, field);

    if (!entry.avoiding) {
      if (!originBlocked && !currentBlocked) return entry.origin;
      entry.avoiding = true;
    }
    if (!currentBlocked && !rectIntersectsCircle(entry.origin, releaseCircle)) {
      entry.avoiding = false;
      entry.target = entry.origin;
      return entry.origin;
    }
    const pushed = this.pushFrom(entry, entry.origin, field);
    return pushed ?? entry.origin;
  }

  pushFrom(entry, bounds, field) {
    // 候选不再受屏幕边界限制: 大窗口也能被推出屏幕边缘, 让出立场.
    const candidates = avoidancePushCandidates(bounds, field);
    if (candidates.length === 0) return null;
    entry.target = candidates[0].target;
    return entry.target;
  }

  trackTargets() {
    for (const target of this.getTargets()) {
      const { key, window } = target ?? {};
      if (!key || !window || window.isDestroyed?.() || !isVisible(window)) continue;
      if (this.excluded.has(window) || this.entries.has(key)) continue;
      const origin = window.getBounds();
      this.entries.set(key, {
        key,
        window,
        origin,
        target: origin,
        avoiding: false,
        interactive: true,
      });
    }
  }

  setInteractive(entry, interactive) {
    if (entry.interactive === interactive) return;
    entry.interactive = interactive;
    entry.window.setIgnoreMouseEvents?.(!interactive);
  }

  // 把某个窗口从托管里放出来, 立刻回到原位, 本轮按住期间不再托管它.
  // 用户开始拖动/缩放、收起/展开或点击便签时调用, 避免和这些操作抢窗口.
  release(window) {
    if (!window) return false;
    this.excluded.add(window);
    for (const [key, entry] of this.entries) {
      if (entry.window !== window) continue;
      this.entries.delete(key);
      this.snapEntry(entry);
      return true;
    }
    return false;
  }

  releaseEntry(entry) {
    this.excluded.add(entry.window);
    this.entries.delete(entry.key);
    this.snapEntry(entry);
  }

  snapEntry(entry) {
    const { window, origin } = entry;
    if (!window || window.isDestroyed?.()) return;
    window.setBounds?.(origin, false);
    window.setIgnoreMouseEvents?.(false);
    entry.interactive = true;
    entry.target = origin;
    entry.avoiding = false;
  }

  snapToOrigins() {
    for (const entry of this.entries.values()) this.snapEntry(entry);
  }

  ensureLoop() {
    if (this.loopTimer !== null) return;
    this.loopTimer = this.setIntervalFn(() => this.tick(), this.followMs);
  }

  stopLoop() {
    if (this.loopTimer === null) return;
    this.clearIntervalFn(this.loopTimer);
    this.loopTimer = null;
  }

  exit() {
    this.phase = "idle";
    this.stopLoop();
    this.lastTickAt = null;
    this.entries.clear();
    this.excluded.clear();
    this.logger.info("便签避让已结束");
  }
}

function isVisible(window) {
  return typeof window.isVisible === "function" ? window.isVisible() : true;
}

function isSamePosition(left, right) {
  return left.x === right.x && left.y === right.y;
}
