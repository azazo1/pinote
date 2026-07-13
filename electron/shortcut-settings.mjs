const MODIFIER_ALIASES = new Map([
  ["cmdorctrl", "CommandOrControl"],
  ["commandorcontrol", "CommandOrControl"],
  ["cmd", "Command"],
  ["command", "Command"],
  ["ctrl", "Control"],
  ["control", "Control"],
  ["option", "Alt"],
  ["alt", "Alt"],
  ["super", "Super"],
  ["meta", "Super"],
  ["shift", "Shift"],
]);

const MODIFIER_ORDER = ["CommandOrControl", "Command", "Control", "Alt", "Super", "Shift"];
const NAMED_KEYS = new Map([
  ["arrowup", "Up"],
  ["up", "Up"],
  ["arrowdown", "Down"],
  ["down", "Down"],
  ["arrowleft", "Left"],
  ["left", "Left"],
  ["arrowright", "Right"],
  ["right", "Right"],
  ["escape", "Escape"],
  ["esc", "Escape"],
  ["enter", "Enter"],
  ["return", "Enter"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["insert", "Insert"],
  ["tab", "Tab"],
  ["space", "Space"],
  ["home", "Home"],
  ["end", "End"],
  ["pageup", "PageUp"],
  ["pagedown", "PageDown"],
  ["plus", "Plus"],
]);

export const SHORTCUT_COMMANDS = Object.freeze([
  { id: "open-main-window", label: "打开主窗口", group: "main", globalEligible: true },
  { id: "new-note", label: "新建便签", group: "main", globalEligible: true },
  { id: "focus-search", label: "搜索便签", group: "main", globalEligible: true },
  { id: "open-settings", label: "打开设置", group: "main", globalEligible: true },
  { id: "sync-now", label: "立即同步", group: "main", globalEligible: true },
  { id: "close-window", label: "关闭当前窗口", group: "window", globalEligible: false },
  { id: "focus-title", label: "聚焦标题", group: "note", globalEligible: false },
  { id: "focus-editor", label: "聚焦正文", group: "note", globalEligible: false },
  { id: "toggle-collapse", label: "收起或展开", group: "note", globalEligible: false },
  { id: "toggle-pin", label: "置顶或取消置顶", group: "note", globalEligible: false },
  { id: "toggle-dock", label: "切换侧边收纳", group: "note", globalEligible: false },
  { id: "toggle-color-picker", label: "便签颜色", group: "note", globalEligible: false },
  { id: "toggle-metadata", label: "分组与标签", group: "note", globalEligible: false },
  { id: "toggle-archive", label: "归档或恢复便签", group: "note", globalEligible: false },
]);

const COMMAND_BY_ID = new Map(SHORTCUT_COMMANDS.map((command) => [command.id, command]));

export function defaultShortcutBindings(platform = process.platform) {
  const mac = platform === "darwin";
  return {
    "open-main-window": { accelerator: "CommandOrControl+0", global: false },
    "new-note": { accelerator: mac ? "Command+N" : "Control+Shift+N", global: false },
    "focus-search": { accelerator: mac ? "Command+F" : "Control+Shift+F", global: false },
    "open-settings": { accelerator: "CommandOrControl+,", global: false },
    "sync-now": { accelerator: null, global: false },
    "close-window": { accelerator: "CommandOrControl+W", global: false },
    "focus-title": { accelerator: "CommandOrControl+1", global: false },
    "focus-editor": { accelerator: "CommandOrControl+2", global: false },
    "toggle-collapse": { accelerator: "CommandOrControl+M", global: false },
    "toggle-pin": { accelerator: "CommandOrControl+Shift+P", global: false },
    "toggle-dock": { accelerator: "CommandOrControl+Shift+D", global: false },
    "toggle-color-picker": { accelerator: "CommandOrControl+Shift+C", global: false },
    "toggle-metadata": { accelerator: "CommandOrControl+Shift+T", global: false },
    "toggle-archive": { accelerator: "CommandOrControl+Shift+M", global: false },
  };
}

export function normalizeAccelerator(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) return null;
  const parts = trimmed.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const modifiers = new Set();
  let key = null;
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES.get(part.toLowerCase());
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    if (key !== null) return null;
    key = normalizeKey(part);
    if (key === null) return null;
  }
  if (!key || ![...modifiers].some((modifier) => modifier !== "Shift")) return null;
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

export function normalizeShortcutBindings(value, platform = process.platform) {
  const defaults = defaultShortcutBindings(platform);
  const normalized = {};
  const used = new Set();
  for (const command of SHORTCUT_COMMANDS) {
    const raw = value?.[command.id];
    const requested = raw?.accelerator === null ? null : normalizeAccelerator(raw?.accelerator);
    const fallback = defaults[command.id].accelerator;
    let accelerator = raw && (raw.accelerator === null || requested !== null) ? requested : fallback;
    if (accelerator && used.has(effectiveAccelerator(accelerator, platform))) {
      accelerator = fallback && !used.has(effectiveAccelerator(fallback, platform)) ? fallback : null;
    }
    if (accelerator) used.add(effectiveAccelerator(accelerator, platform));
    normalized[command.id] = {
      accelerator,
      global: Boolean(raw?.global && command.globalEligible && accelerator),
    };
  }
  return normalized;
}

export function updateShortcutBinding(bindings, id, patch, platform = process.platform) {
  const command = COMMAND_BY_ID.get(id);
  if (!command) throw new Error("快捷键命令不存在");
  const current = normalizeShortcutBindings(bindings, platform);
  let accelerator = current[id].accelerator;
  if (Object.hasOwn(patch ?? {}, "accelerator")) {
    accelerator = patch.accelerator === null ? null : normalizeAccelerator(patch.accelerator);
    if (patch.accelerator !== null && accelerator === null) throw new Error("快捷键需要包含修饰键和普通键");
  }
  let global = Object.hasOwn(patch ?? {}, "global")
    ? Boolean(patch.global)
    : current[id].global;
  if (!accelerator) global = false;
  if (global && !command.globalEligible) throw new Error("此命令不支持全局监听");
  if (global && !accelerator) throw new Error("请先设置快捷键");
  if (accelerator) {
    const duplicate = SHORTCUT_COMMANDS.find((item) => (
      item.id !== id && current[item.id].accelerator
        && effectiveAccelerator(current[item.id].accelerator, platform) === effectiveAccelerator(accelerator, platform)
    ));
    if (duplicate) throw new Error(`快捷键已用于${duplicate.label}`);
  }
  return {
    ...current,
    [id]: { accelerator, global: Boolean(global && accelerator) },
  };
}

export function resetShortcutBinding(bindings, id, platform = process.platform) {
  if (!COMMAND_BY_ID.has(id)) throw new Error("快捷键命令不存在");
  const defaults = defaultShortcutBindings(platform);
  return updateShortcutBinding(bindings, id, defaults[id], platform);
}

export function shortcutCommand(id) {
  return COMMAND_BY_ID.get(id) ?? null;
}

function normalizeKey(value) {
  const lower = value.toLowerCase();
  if (NAMED_KEYS.has(lower)) return NAMED_KEYS.get(lower);
  if (/^[a-z0-9]$/i.test(value)) return value.toUpperCase();
  if (/^f(?:[1-9]|1\d|2[0-4])$/i.test(value)) return value.toUpperCase();
  if ([",", ".", "/", ";", "'", "[", "]", "\\", "-", "="].includes(value)) return value;
  return null;
}

function effectiveAccelerator(accelerator, platform) {
  return accelerator
    .replace("CommandOrControl", platform === "darwin" ? "Command" : "Control")
    .toLowerCase();
}
