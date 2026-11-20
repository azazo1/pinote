import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import sharp from "sharp";

// 原生菜单只能显示位图, 这里把便签菜单用到的 lucide 图标渲染成 PNG.
// macOS 用黑色模板图并交给系统反色, 其它平台用彩色图, 每套都带 1x 与 2x.
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = join(projectRoot, "electron", "assets", "menu");
const templateColor = "#000000";
const colorInk = "#30302d";
const icons = {
  plus: "plus",
  palette: "palette",
  "app-window": "app-window",
  cloud: "cloud",
  "cloud-off": "cloud-off",
  "archive-restore": "archive-restore",
  "circle-check-big": "circle-check-big",
  "trash-2": "trash-2",
};

await mkdir(outputRoot, { recursive: true });

for (const [name, moduleName] of Object.entries(icons)) {
  const { __iconNode } = await import(`lucide-react/dist/esm/icons/${moduleName}.mjs`);
  const template = iconSvg(__iconNode, templateColor, 24);
  const colored = iconSvg(__iconNode, colorInk, 24);
  await Promise.all([
    renderIcon(template, 16, join(outputRoot, `${name}Template.png`)),
    renderIcon(template, 32, join(outputRoot, `${name}Template@2x.png`)),
    renderIcon(colored, 16, join(outputRoot, `${name}.png`)),
    renderIcon(colored, 32, join(outputRoot, `${name}@2x.png`)),
  ]);
}

function iconSvg(node, color, size) {
  const children = node.map(([tag, props]) => {
    const attributes = Object.entries(props)
      .filter(([key]) => key !== "key")
      .map(([key, value]) => `${key}="${String(value).replaceAll("currentColor", color)}"`)
      .join(" ");
    return `<${tag} ${attributes} />`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`;
}

async function renderIcon(svg, size, output) {
  await sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(output);
}
