import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import sharp from "sharp";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const source = join(projectRoot, "build", "icon-source.svg");
const traySource = join(projectRoot, "build", "tray-icon-source.svg");
const outputRoot = join(projectRoot, "build", "generated");
const linuxIconRoot = join(outputRoot, "icons");
const trayIconRoot = join(projectRoot, "electron", "assets");
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];

await mkdir(linuxIconRoot, { recursive: true });
await mkdir(trayIconRoot, { recursive: true });
await Promise.all([
  renderIcon(source, 1024, join(outputRoot, "icon.png")),
  ...sizes.map((size) => renderIcon(source, size, join(linuxIconRoot, `${size}x${size}.png`))),
  renderIcon(traySource, 16, join(trayIconRoot, "trayTemplate.png")),
  renderIcon(traySource, 32, join(trayIconRoot, "trayTemplate@2x.png")),
]);

async function renderIcon(input, size, output) {
  await sharp(input, { density: 256 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(output);
}
