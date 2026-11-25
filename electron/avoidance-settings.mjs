// 便签避让按键: 平台默认值与可选项.
// 这里只是"按住哪个修饰键", 不是组合快捷键, 因此独立于 shortcut-settings 的 accelerator 体系.

export const AVOIDANCE_MODIFIERS = Object.freeze(["meta", "alt", "control", "shift"]);

// 与 native/mac-modifier-state 输出的位掩码保持一致.
export const AVOIDANCE_MODIFIER_BITS = Object.freeze({
  meta: 1,
  alt: 2,
  control: 4,
  shift: 8,
});

// macOS 用 Command, Windows 与 Linux 用 Alt: 单按都不会产生输入副作用, 也不会触发系统菜单.
export function defaultAvoidanceModifier(platform = process.platform) {
  return platform === "darwin" ? "meta" : "alt";
}

export function normalizeAvoidanceModifier(value, platform = process.platform) {
  return AVOIDANCE_MODIFIERS.includes(value) ? value : defaultAvoidanceModifier(platform);
}

// 按键名按平台习惯展示: Windows 的 Meta 是 Win 键, Linux 上是 Super.
export function avoidanceModifierOptions(platform = process.platform) {
  return [
    { id: "meta", label: metaModifierLabel(platform) },
    { id: "alt", label: platform === "darwin" ? "Option" : "Alt" },
    { id: "control", label: platform === "darwin" ? "Control" : "Ctrl" },
    { id: "shift", label: "Shift" },
  ];
}

export function avoidanceModifierLabel(modifier, platform = process.platform) {
  return avoidanceModifierOptions(platform).find((option) => option.id === normalizeAvoidanceModifier(modifier, platform))?.label ?? "Shift";
}

function metaModifierLabel(platform) {
  if (platform === "darwin") return "Command";
  if (platform === "win32") return "Win";
  return "Super";
}
