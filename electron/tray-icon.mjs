import { readFileSync } from "node:fs";
import { nativeImage } from "electron";

export function createTrayIcon({
  platform = process.platform,
  templatePath,
  retinaTemplatePath,
  appIconPath,
}) {
  if (platform === "darwin") {
    try {
      const image = nativeImage.createFromBuffer(readFileSync(templatePath), { scaleFactor: 1 });
      image.addRepresentation({
        scaleFactor: 2,
        buffer: readFileSync(retinaTemplatePath),
      });
      if (!image.isEmpty()) {
        image.setTemplateImage(true);
        return image;
      }
    } catch {
      // 生成资源不可用时回退到应用图标.
    }
  }

  const source = nativeImage.createFromPath(appIconPath);
  if (source.isEmpty()) return source;
  const size = platform === "darwin" ? 18 : 20;
  return source.resize({ width: size, height: size, quality: "best" });
}
