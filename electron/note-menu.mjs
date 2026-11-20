import { Menu, nativeImage } from "electron";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 便签窗口都很小, 菜单改由系统弹出, 因此菜单高度不再受窗口边界限制.
export const NOTE_MENU_ACTIONS = new Set([
  "create-note",
  "open-color-picker",
  "open-main-window",
  "open-sync",
  "toggle-local-only",
  "toggle-archive",
  "delete-note",
]);

const menuIconRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "menu");
const menuIcons = new Map();

export function sanitizeNoteMenuRequest(request) {
  const anchor = request?.anchor;
  const x = Number(anchor?.x);
  const y = Number(anchor?.y);
  return {
    archived: request?.archived === true,
    localOnly: request?.localOnly === true,
    anchor: Number.isFinite(x) && Number.isFinite(y) ? { x: Math.round(x), y: Math.round(y) } : null,
  };
}

export function noteMenuTemplate({ archived, localOnly }, onSelect) {
  const action = (id, label, iconName) => {
    const icon = menuIcon(iconName);
    return {
      label,
      ...(icon ? { icon } : {}),
      click: () => {
        if (NOTE_MENU_ACTIONS.has(id)) onSelect(id);
      },
    };
  };
  return [
    action("create-note", "新建便签", "plus"),
    action("open-color-picker", "便签颜色", "palette"),
    action("open-main-window", "打开主窗口", "app-window"),
    action("open-sync", "云同步", "cloud"),
    action("toggle-local-only", localOnly ? "恢复云同步" : "仅保留在本机", localOnly ? "cloud" : "cloud-off"),
    { type: "separator" },
    action("toggle-archive", archived ? "恢复为活跃便签" : "标记完成", archived ? "archive-restore" : "circle-check-big"),
    action("delete-note", "删除便签", "trash-2"),
  ];
}

export function showNoteMenu(window, request) {
  if (!window || window.isDestroyed()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let selected = null;
    const menu = Menu.buildFromTemplate(noteMenuTemplate(request, (id) => {
      selected = id;
    }));
    menu.popup({
      window,
      ...(request.anchor ?? {}),
      // 菜单关闭回调与菜单项点击回调的先后顺序在各平台不一致, 因此延后一个宏任务再取值.
      callback: () => {
        setTimeout(() => resolve(selected), 0);
      },
    });
  });
}

function menuIcon(name) {
  const cached = menuIcons.get(name);
  if (cached !== undefined) return cached;
  // macOS 菜单图标要交给系统反色, 因此使用黑色模板图; 其它平台直接用彩色图.
  const template = process.platform === "darwin";
  const base = template ? `${name}Template` : name;
  const image = nativeImage.createFromPath(path.join(menuIconRoot, `${base}.png`));
  const retina = readIconFile(path.join(menuIconRoot, `${base}@2x.png`));
  if (retina) image.addRepresentation({ scaleFactor: 2, buffer: retina });
  const resolved = image.isEmpty() ? null : image;
  if (resolved && template) resolved.setTemplateImage(true);
  menuIcons.set(name, resolved);
  return resolved;
}

function readIconFile(filePath) {
  try {
    return readFileSync(filePath);
  } catch {
    return null;
  }
}
