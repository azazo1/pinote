import type { NoteResizeEdge, WindowBounds } from "../types";

export const NOTE_RESIZE_EDGES = ["n", "s", "e", "w", "nw", "sw", "se"] as const satisfies readonly NoteResizeEdge[];

export type { NoteResizeEdge, WindowBounds } from "../types";

interface ResizeLimits {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

const DEFAULT_LIMITS: ResizeLimits = {
  minWidth: 253,
  minHeight: 180,
  maxWidth: 760,
  maxHeight: 900,
};

export function resizeWindowBounds(
  start: WindowBounds,
  edge: NoteResizeEdge,
  deltaX: number,
  deltaY: number,
  limits: ResizeLimits = DEFAULT_LIMITS,
): WindowBounds {
  const fromLeft = edge.includes("w");
  const fromTop = edge.includes("n");
  const horizontalDelta = edge.includes("e") ? deltaX : fromLeft ? -deltaX : 0;
  const verticalDelta = edge.includes("s") ? deltaY : fromTop ? -deltaY : 0;
  const width = clamp(Math.round(start.width + horizontalDelta), limits.minWidth, limits.maxWidth);
  const height = clamp(Math.round(start.height + verticalDelta), limits.minHeight, limits.maxHeight);

  return {
    x: fromLeft ? Math.round(start.x + start.width - width) : Math.round(start.x),
    y: fromTop ? Math.round(start.y + start.height - height) : Math.round(start.y),
    width,
    height,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
