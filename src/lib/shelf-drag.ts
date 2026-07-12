export const shelfDragThreshold = 3;

export function shouldStartShelfDrag(deltaX: number, deltaY: number) {
  return Math.hypot(deltaX, deltaY) > shelfDragThreshold;
}
