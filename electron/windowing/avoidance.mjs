import { isPointNearBounds } from "./shelf-proximity.mjs";

// 鼠标离便签多远仍算"在附近", 避免用户必须精确悬停.
export const AVOIDANCE_PROXIMITY = 24;
// 便签飘出屏幕后保留的余量, 防止边缘残留一小条像素.
export const AVOIDANCE_EXIT_MARGIN = 48;
// 出发与返回的基础时长, 距离越远补得越多, 避免长距离移动速度失真.
const EXIT_BASE_MS = 320;
const RETURN_BASE_MS = 280;
const EXIT_PIXELS_PER_MS = 0.22;
const RETURN_PIXELS_PER_MS = 0.16;
export const AVOIDANCE_EXIT_MIN_MS = 340;
export const AVOIDANCE_EXIT_MAX_MS = 720;
export const AVOIDANCE_RETURN_MIN_MS = 300;
export const AVOIDANCE_RETURN_MAX_MS = 620;
// 多张便签依次出发的间隔, 形成层次而不是整齐划一.
export const AVOIDANCE_STAGGER_MS = 45;

// 便签是否在鼠标附近, 需要让位.
export function isAvoidanceTarget(point, bounds, proximity = AVOIDANCE_PROXIMITY) {
  return isPointNearBounds(point, bounds, proximity);
}

// 取离便签中心最近的屏幕边缘, 便签朝那一侧飘走; 平局时优先向下, 更像落叶.
export function avoidanceExitDirection(bounds, area) {
  if (!isFiniteBounds(bounds) || !isFiniteBounds(area)) return "bottom";
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const distances = {
    bottom: area.y + area.height - centerY,
    left: centerX - area.x,
    right: area.x + area.width - centerX,
    top: centerY - area.y,
  };
  let direction = "bottom";
  for (const candidate of ["left", "right", "top"]) {
    if (distances[candidate] < distances[direction]) direction = candidate;
  }
  return direction;
}

// 飘走后的落点: 整个窗口移到屏幕外, 并带一点侧向漂移, 让路径不那么笔直.
export function avoidanceExitBounds(bounds, area) {
  if (!isFiniteBounds(bounds) || !isFiniteBounds(area)) return bounds;
  const direction = avoidanceExitDirection(bounds, area);
  const driftX = Math.round(Math.min(64, bounds.width * 0.15));
  const driftY = Math.round(Math.min(64, bounds.height * 0.12));
  const size = { width: bounds.width, height: bounds.height };
  switch (direction) {
    case "left":
      return { x: area.x - bounds.width - AVOIDANCE_EXIT_MARGIN, y: bounds.y + driftY, ...size };
    case "right":
      return { x: area.x + area.width + AVOIDANCE_EXIT_MARGIN, y: bounds.y + driftY, ...size };
    case "top":
      return { x: bounds.x + driftX, y: area.y - bounds.height - AVOIDANCE_EXIT_MARGIN, ...size };
    default:
      return { x: bounds.x + driftX, y: area.y + area.height + AVOIDANCE_EXIT_MARGIN, ...size };
  }
}

export function avoidanceExitDuration(from, to) {
  return Math.round(clamp(EXIT_BASE_MS + boundsDistance(from, to) * EXIT_PIXELS_PER_MS, AVOIDANCE_EXIT_MIN_MS, AVOIDANCE_EXIT_MAX_MS));
}

export function avoidanceReturnDuration(from, to) {
  return Math.round(clamp(RETURN_BASE_MS + boundsDistance(from, to) * RETURN_PIXELS_PER_MS, AVOIDANCE_RETURN_MIN_MS, AVOIDANCE_RETURN_MAX_MS));
}

// 出发先慢后快, 像纸片被吹走; 返回先快后慢, 像落回原位.
export function easeInQuad(progress) {
  return progress * progress;
}

export function easeOutCubic(progress) {
  return 1 - Math.pow(1 - progress, 3);
}

export function boundsDistance(left, right) {
  if (!isFiniteBounds(left) || !isFiniteBounds(right)) return 0;
  return Math.hypot(
    left.x + left.width / 2 - (right.x + right.width / 2),
    left.y + left.height / 2 - (right.y + right.height / 2),
  );
}

function isFiniteBounds(bounds) {
  return Number.isFinite(bounds?.x)
    && Number.isFinite(bounds?.y)
    && Number.isFinite(bounds?.width)
    && Number.isFinite(bounds?.height)
    && bounds.width > 0
    && bounds.height > 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
