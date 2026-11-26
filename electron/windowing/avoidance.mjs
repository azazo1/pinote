// 便签避让的几何模型: 以鼠标为中心的圆形"立场".
// 与立场相交的便签会被推到立场边缘之外, 只移动刚好够的距离, 让立场里露出后面的内容.

export const AVOIDANCE_RADIUS = 140;
// 便签与立场之间留的间隙, 避免贴着圆周抖动.
export const AVOIDANCE_GAP = 12;
// 跟随鼠标的刷新间隔, 与显示器刷新同步, 避免 30Hz 的阶梯感.
export const AVOIDANCE_FOLLOW_MS = 16;
// 平滑移动的时间常数: 每帧向目标靠近的比例由经过的时间决定, 与帧率无关.
export const AVOIDANCE_SMOOTH_TAU_MS = 60;
// 便签要完全离开这个加宽的圆才判定为"不再遮蔽", 避免边缘微动时反复推回/收回.
export const AVOIDANCE_RELEASE_MARGIN = 28;
// 位移小于该距离就认为到位, 停止重复 setBounds.
export const AVOIDANCE_SETTLE_PX = 2;

// 鼠标当前位置对应的立场圆, 半径包含让位间隙.
export function avoidanceField(pointer) {
  if (!Number.isFinite(pointer?.x) || !Number.isFinite(pointer?.y)) return null;
  return { x: pointer.x, y: pointer.y, radius: AVOIDANCE_RADIUS + AVOIDANCE_GAP };
}

// 文本插入点矩形对应的立场圆, 以矩形中心为圆心, 半径与鼠标立场相同.
export function avoidanceFieldFromRect(rect) {
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return null;
  const width = Number.isFinite(rect.width) ? Math.max(0, rect.width) : 0;
  const height = Number.isFinite(rect.height) ? Math.max(0, rect.height) : 0;
  return {
    x: rect.x + width / 2,
    y: rect.y + height / 2,
    radius: AVOIDANCE_RADIUS + AVOIDANCE_GAP,
  };
}

// 矩形与立场是否相交, 用"圆心到矩形的最近点"判断.
export function rectIntersectsCircle(bounds, circle) {
  if (!isFiniteBounds(bounds) || !circle) return false;
  const nearestX = clampValue(circle.x, bounds.x, bounds.x + bounds.width);
  const nearestY = clampValue(circle.y, bounds.y, bounds.y + bounds.height);
  const deltaX = circle.x - nearestX;
  const deltaY = circle.y - nearestY;
  return deltaX * deltaX + deltaY * deltaY < circle.radius * circle.radius;
}

// 把便签推到立场外的候选位置, 按"能真正移动的方向优先, 其次位移更小"排序.
// display 是显示器信息 ({ bounds, workArea }): 工作区比显示器小的一侧通常被菜单栏,
// 任务栏或 Dock 占用, 朝那一侧越界会被系统顶住, 这些候选降到后面; 没有缺口的侧
// (例如屏幕左右) 即使越界也允许, 大窗口和贴边的小条照样能让出立场.
export function avoidancePushCandidates(bounds, circle, display = null) {
  if (!isFiniteBounds(bounds) || !circle) return [];
  const radius = circle.radius;
  const raw = [
    { direction: "left", x: (circle.x - radius) - bounds.width, y: bounds.y },
    { direction: "right", x: circle.x + radius, y: bounds.y },
    { direction: "up", x: bounds.x, y: (circle.y - radius) - bounds.height },
    { direction: "down", x: bounds.x, y: circle.y + radius },
  ];
  const area = display?.workArea ?? null;
  const screen = display?.bounds ?? null;
  return raw
    .map(({ direction, x, y }) => {
      const target = { x, y, width: bounds.width, height: bounds.height };
      return {
        direction,
        target,
        distance: Math.hypot(x - bounds.x, y - bounds.y),
        blocked: isBlockedBySystemEdge(target, area, screen),
      };
    })
    .filter((candidate) => !rectIntersectsCircle(candidate.target, circle))
    .sort((left, right) => {
      if (left.blocked !== right.blocked) return left.blocked ? 1 : -1;
      return left.distance - right.distance;
    });
}

// 目标跨过了"系统 UI 占用的那一侧"才算被挡住: 只有工作区比显示器小的侧 (菜单栏,
// 任务栏, Dock) 会拦住窗口, 没有缺口的侧允许窗口部分出屏.
function isBlockedBySystemEdge(target, area, screen) {
  if (!area || !screen || !isFiniteBounds(target)) return false;
  const screenRight = screen.x + screen.width;
  const screenBottom = screen.y + screen.height;
  const areaRight = area.x + area.width;
  const areaBottom = area.y + area.height;
  if (area.y > screen.y && target.y < area.y) return true;
  if (areaBottom < screenBottom && target.y + target.height > areaBottom) return true;
  if (area.x > screen.x && target.x < area.x) return true;
  if (areaRight < screenRight && target.x + target.width > areaRight) return true;
  return false;
}

// 逐帧靠近目标位置, 到位后直接吸附, 避免永远差一像素.
// smoothing 由服务按经过的时间计算, 保证不同帧率下速度一致.
export function approachBounds(current, target, smoothing = 0.2) {
  const deltaX = target.x - current.x;
  const deltaY = target.y - current.y;
  if (boundsSettled(current, target)) {
    return { ...target };
  }
  return {
    x: Math.round(current.x + deltaX * smoothing),
    y: Math.round(current.y + deltaY * smoothing),
    width: target.width,
    height: target.height,
  };
}

export function boundsSettled(current, target, tolerance = AVOIDANCE_SETTLE_PX) {
  return Math.abs(current.x - target.x) <= tolerance && Math.abs(current.y - target.y) <= tolerance;
}

function isFiniteBounds(bounds) {
  return Number.isFinite(bounds?.x)
    && Number.isFinite(bounds?.y)
    && Number.isFinite(bounds?.width)
    && Number.isFinite(bounds?.height)
    && bounds.width > 0
    && bounds.height > 0;
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
