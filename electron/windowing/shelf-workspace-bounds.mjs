export function shelfWorkspaceLayout({ area, listBounds, edge, noteBounds, collapsed }) {
  const availableEditorWidth = Math.max(0, area.width - listBounds.width);
  const editorWidth = Math.min(collapsed ? 253 : noteBounds.width, availableEditorWidth);
  const editorHeight = Math.min(collapsed ? 22 : noteBounds.height, area.height);
  const width = Math.min(area.width, listBounds.width + editorWidth);
  const height = Math.min(area.height, Math.max(listBounds.height, editorHeight));
  const centerY = listBounds.y + listBounds.height / 2;
  const y = clamp(Math.round(centerY - height / 2), area.y, area.y + area.height - height);
  const leftSpace = listBounds.x - area.x;
  const rightSpace = area.x + area.width - listBounds.x - listBounds.width;
  const editorSide = edge === "right"
    ? "left"
    : edge === "left"
      ? "right"
      : leftSpace >= editorWidth || leftSpace >= rightSpace ? "left" : "right";
  const desiredX = editorSide === "left" ? listBounds.x - editorWidth : listBounds.x;
  const x = clamp(desiredX, area.x, area.x + area.width - width);

  return {
    bounds: { x, y, width, height },
    metrics: { editorSide, editorWidth, editorHeight },
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}
