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

// 矩形与立场是否相交, 用"圆心到矩形的最近点"判断.
export function rectIntersectsCircle(bounds, circle) {
  if (!isFiniteBounds(bounds) || !circle) return false;
  const nearestX = clampValue(circle.x, bounds.x, bounds.x + bounds.width);
  const nearestY = clampValue(circle.y, bounds.y, bounds.y + bounds.height);
  const deltaX = circle.x - nearestX;
  const deltaY = circle.y - nearestY;
  return deltaX * deltaX + deltaY * deltaY < circle.radius * circle.radius;
}

// 把便签推到立场外的所有可行位置, 按位移从小到大排序.
// 每个候选都完整留在屏幕内, 并且与立场不相交.
export function avoidancePushCandidates(bounds, circle, area) {
  if (!isFiniteBounds(bounds) || !circle) return [];
  const radius = circle.radius;
  const raw = [
    { direction: "left", x: (circle.x - radius) - bounds.width, y: bounds.y },
    { direction: "right", x: circle.x + radius, y: bounds.y },
    { direction: "up", x: bounds.x, y: (circle.y - radius) - bounds.height },
    { direction: "down", x: bounds.x, y: circle.y + radius },
  ];
  return raw
    .map(({ direction, x, y }) => {
      const target = clampBoundsToArea({ x, y, width: bounds.width, height: bounds.height }, area);
      return {
        direction,
        target,
        distance: Math.hypot(target.x - bounds.x, target.y - bounds.y),
      };
    })
    .filter((candidate) => !rectIntersectsCircle(candidate.target, circle))
    .sort((left, right) => left.distance - right.distance);
}

// 把便签推到立场外: 取位移最小的可行位置.
export function avoidancePushTarget(bounds, circle, area) {
  if (!isFiniteBounds(bounds) || !circle) return bounds;
  if (!rectIntersectsCircle(bounds, circle)) return bounds;
  const candidates = avoidancePushCandidates(bounds, circle, area);
  if (candidates.length > 0) return candidates[0].target;
  // 屏幕太小或便签太大时无法完全避开, 退回离圆心最远的一个方向, 尽力露出立场.
  return farthestFromCircle(bounds, circle, area) ?? bounds;
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

function farthestFromCircle(bounds, circle, area) {
  const radius = circle.radius;
  const raw = [
    { x: (circle.x - radius) - bounds.width, y: bounds.y },
    { x: circle.x + radius, y: bounds.y },
    { x: bounds.x, y: (circle.y - radius) - bounds.height },
    { x: bounds.x, y: circle.y + radius },
  ];
  let best = null;
  let bestDistance = -1;
  for (const position of raw) {
    const target = clampBoundsToArea({ ...position, width: bounds.width, height: bounds.height }, area);
    const nearestX = clampValue(circle.x, target.x, target.x + target.width);
    const nearestY = clampValue(circle.y, target.y, target.y + target.height);
    const distance = Math.hypot(circle.x - nearestX, circle.y - nearestY);
    if (distance > bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

function clampBoundsToArea(bounds, area) {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    x: clampValue(bounds.x, area.x, area.x + area.width - width),
    y: clampValue(bounds.y, area.y, area.y + area.height - height),
    width,
    height,
  };
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
