import {
  AVOIDANCE_FOLLOW_MS,
  AVOIDANCE_RELEASE_MARGIN,
  AVOIDANCE_SMOOTH_TAU_MS,
  approachBounds,
  avoidanceField,
  avoidanceFieldFromRect,
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
    displayFor,
    getCaret = () => null,
    isCaretEnabled = () => false,
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
    this.displayFor = displayFor ?? (() => null);
    this.getCaret = getCaret;
    this.isCaretEnabled = isCaretEnabled;
    this.logger = logger;
    this.smoothTauMs = smoothTauMs;
    this.followMs = followMs;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.now = now;
    this.phase = "idle";
    this.suspended = false;
    this.entries = new Map();
    this.excluded = new Set();
    // 因为获得焦点而被放回原位的窗口; 失焦后要恢复参与避让.
    this.focusReleased = new Set();
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
    this.suspended = false;
    this.excluded.clear();
    this.focusReleased.clear();
    this.trackTargets();
    // 即使当前没有可参与的窗口也保持立场: 编辑中的便签收起后, 或尺寸动画结束后,
    // 会由 trackTargets 自动加入, 不需要先关掉再打开.
    this.lastTickAt = null;
    this.ensureLoop();
    this.logger.info("便签避让立场已开启", { count: this.entries.size });
    return true;
  }

  // 松开修饰键: 所有便签回到原位, 平滑结束后退出.
  finish() {
    if (this.phase !== "field") return false;
    this.phase = "returning";
    this.suspended = false;
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

  // 保持模式下按住修饰键: 临时取消避让, 便签回到原位; 松开后恢复.
  suspend() {
    if (this.phase !== "field" || this.suspended) return false;
    this.suspended = true;
    return true;
  }

  resume() {
    if (!this.suspended) return false;
    this.suspended = false;
    return true;
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
    const fields = this.phase === "field" ? this.currentFields() : [];
    const focused = this.getFocusedWindow() ?? null;
    this.restoreFocusReleasedWindows(focused);
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
      // 临时取消避让时不推, 直接回原位.
      const target = this.suspended || fields.length === 0 ? entry.origin : this.targetFor(entry, current, fields);
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

  // 当前所有立场: 鼠标, 以及启用且可读时的文本插入点.
  // 两者几乎重合时只保留光标立场, 免得同一块区域被推两次.
  currentFields() {
    const mouse = avoidanceField(this.getCursor());
    let caretField = null;
    if (this.isCaretEnabled()) {
      const caret = this.getCaret();
      caretField = caret ? avoidanceFieldFromRect(caret) : null;
    }
    if (!mouse) return caretField ? [caretField] : [];
    if (!caretField) return [mouse];
    const distance = Math.hypot(caretField.x - mouse.x, caretField.y - mouse.y);
    return distance < mouse.radius ? [caretField] : [mouse, caretField];
  }

  // 目标位置: 始终按"原位"算出所有立场外的最小旁位, 不按当前位置累加.
  targetFor(entry, current, fields) {
    if (this.phase !== "field" || fields.length === 0) return entry.origin;
    const releaseFields = fields.map((field) => ({ ...field, radius: field.radius + AVOIDANCE_RELEASE_MARGIN }));
    const originBlocked = fields.some((field) => rectIntersectsCircle(entry.origin, field));
    const currentBlocked = fields.some((field) => rectIntersectsCircle(current, field));

    if (!entry.avoiding) {
      if (!originBlocked && !currentBlocked) return entry.origin;
      entry.avoiding = true;
    }
    // 回位只看原位: 原位已离开立场 (含去抖圈) 就必须回原位.
    // 之前要求"当前位置也不在立场内"才回位, 推位若被边缘挡在立场边上, 便签会一直停在那里.
    const originInRelease = releaseFields.some((field) => rectIntersectsCircle(entry.origin, field));
    if (!originInRelease) {
      entry.avoiding = false;
      entry.target = entry.origin;
      return entry.origin;
    }
    // 原位仍在立场/去抖圈内: 推开; 推位若还压在立场里, 也重新按原位推.
    if (originBlocked || currentBlocked) {
      const pushed = this.pushFrom(entry, entry.origin, fields);
      if (pushed) return pushed;
    }
    return entry.target ?? entry.origin;
  }

  // 依次把便签推出每个立场; 最后仍与任一立场相交就放弃这次推开.
  pushFrom(entry, bounds, fields) {
    // 系统 UI (菜单栏/任务栏/Dock) 占用的那一侧会被顶住, 排序里已降到后面.
    const display = this.displayFor(bounds);
    let target = bounds;
    for (let pass = 0; pass < 4; pass += 1) {
      const blocking = fields.find((field) => rectIntersectsCircle(target, field));
      if (!blocking) {
        entry.target = target;
        return target;
      }
      const candidates = avoidancePushCandidates(target, blocking, display);
      if (candidates.length === 0) return null;
      target = candidates[0].target;
    }
    if (fields.some((field) => rectIntersectsCircle(target, field))) return null;
    entry.target = target;
    return target;
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
    this.focusReleased.add(entry.window);
    this.entries.delete(entry.key);
    this.snapEntry(entry);
  }

  // 因聚焦被放回原位的窗口, 一旦不再是"编辑中" (失焦或收起) 就恢复参与避让.
  // 用户显式操作 (拖动/收起/关闭) 造成的排除不走这里, 仍然保持到本轮结束.
  restoreFocusReleasedWindows(editingWindow) {
    if (this.focusReleased.size === 0) return;
    for (const window of [...this.focusReleased]) {
      if (!window || window.isDestroyed?.()) {
        this.focusReleased.delete(window);
        continue;
      }
      if (window === editingWindow) continue;
      this.focusReleased.delete(window);
      this.excluded.delete(window);
    }
  }

  // 把窗口放回当前这轮避让: 收起动画结束后调用, 收起的小条可以重新参与避让.
  include(window) {
    if (!window) return false;
    return this.excluded.delete(window);
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
    this.suspended = false;
    this.stopLoop();
    this.lastTickAt = null;
    this.entries.clear();
    this.excluded.clear();
    this.focusReleased.clear();
    this.logger.info("便签避让已结束");
  }
}

function isVisible(window) {
  return typeof window.isVisible === "function" ? window.isVisible() : true;
}

function isSamePosition(left, right) {
  return left.x === right.x && left.y === right.y;
}
