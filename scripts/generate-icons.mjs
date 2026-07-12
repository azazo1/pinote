import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import sharp from "sharp";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const source = join(projectRoot, "build", "icon-source.svg");
const outputRoot = join(projectRoot, "build", "generated");
const linuxIconRoot = join(outputRoot, "icons");
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];

await mkdir(linuxIconRoot, { recursive: true });
await Promise.all([
  renderIcon(1024, join(outputRoot, "icon.png")),
  ...sizes.map((size) => renderIcon(size, join(linuxIconRoot, `${size}x${size}.png`))),
]);

async function renderIcon(size, output) {
  await sharp(source, { density: 256 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(output);
}
