export const SHELF_DOCK_PROXIMITY = 28;

export function isPointNearBounds(point, bounds, proximity = SHELF_DOCK_PROXIMITY) {
  if (!isFinitePoint(point) || !isFiniteBounds(bounds) || !Number.isFinite(proximity) || proximity < 0) {
    return false;
  }
  return point.x >= bounds.x - proximity
    && point.x <= bounds.x + bounds.width + proximity
    && point.y >= bounds.y - proximity
    && point.y <= bounds.y + bounds.height + proximity;
}

function isFinitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function isFiniteBounds(bounds) {
  return Number.isFinite(bounds?.x)
    && Number.isFinite(bounds?.y)
    && Number.isFinite(bounds?.width)
    && Number.isFinite(bounds?.height)
    && bounds.width >= 0
    && bounds.height >= 0;
}
