export type EmacsMotionKey = "a" | "e" | "b" | "f" | "p" | "n";

function lineStart(value: string, position: number) {
  return value.lastIndexOf("\n", position - 1) + 1;
}

function lineEnd(value: string, position: number) {
  const end = value.indexOf("\n", position);
  return end === -1 ? value.length : end;
}

function previousCharacter(value: string, position: number) {
  if (position <= 0) return 0;
  const last = value.charCodeAt(position - 1);
  const previous = position > 1 ? value.charCodeAt(position - 2) : 0;
  const isSurrogatePair = last >= 0xdc00 && last <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff;
  return Math.max(0, position - (isSurrogatePair ? 2 : 1));
}

function nextCharacter(value: string, position: number) {
  if (position >= value.length) return value.length;
  const first = value.charCodeAt(position);
  const next = position + 1 < value.length ? value.charCodeAt(position + 1) : 0;
  const isSurrogatePair = first >= 0xd800 && first <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
  return Math.min(value.length, position + (isSurrogatePair ? 2 : 1));
}

function verticalPosition(value: string, position: number, direction: -1 | 1) {
  const start = lineStart(value, position);
  const column = position - start;
  if (direction === -1) {
    if (start === 0) return 0;
    const previousEnd = start - 1;
    const previousStart = lineStart(value, previousEnd);
    return Math.min(previousStart + column, previousEnd);
  }

  const end = lineEnd(value, position);
  if (end === value.length) return value.length;
  const nextStart = end + 1;
  return Math.min(nextStart + column, lineEnd(value, nextStart));
}

export function emacsMotionTarget(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  key: EmacsMotionKey,
) {
  if (key === "a") return lineStart(value, selectionStart);
  if (key === "e") return lineEnd(value, selectionEnd);
  if (key === "b") return previousCharacter(value, selectionStart);
  if (key === "f") return nextCharacter(value, selectionEnd);
  if (key === "p") return verticalPosition(value, selectionStart, -1);
  return verticalPosition(value, selectionEnd, 1);
}
