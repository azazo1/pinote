#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 编译 macOS 的修饰键状态轮询 helper (native/mac-modifier-state/main.c).
// 其他平台不需要这个 helper: Windows 与 Linux 走无权限要求的 uiohook 全局键盘钩子.
// 缺少 C 工具链 (Xcode command line tools) 时只给出警告并跳过, 不阻塞开发与前端构建.

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(currentDir, "..");

if (process.platform !== "darwin") {
  console.log("当前平台不需要构建 mac-modifier-state, 跳过");
  process.exit(0);
}

const outDir = path.join(root, "build", "generated");
const outFile = path.join(outDir, "mac-modifier-state");
const source = path.join(root, "native", "mac-modifier-state", "main.c");

if (!existsSync(source)) {
  console.error(`找不到 helper 源码: ${path.relative(root, source)}`);
  process.exit(1);
}

let cc;
try {
  cc = execFileSync("xcrun", ["--find", "clang"], { encoding: "utf8" }).trim();
} catch {
  console.warn("未找到 clang (xcrun --find clang), 跳过 mac-modifier-state 构建; 便签避让将不可用");
  process.exit(0);
}

// 显式给出 SDK, 否则某些 Xcode 版本里 clang 找不到框架头文件.
let sdk = null;
try {
  sdk = execFileSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" }).trim() || null;
} catch {
  sdk = null;
}

mkdirSync(outDir, { recursive: true });
execFileSync(cc, [
  "-O2",
  ...(sdk ? ["-isysroot", sdk] : []),
  "-framework", "ApplicationServices",
  source,
  "-o", outFile,
], { stdio: "inherit" });
chmodSync(outFile, 0o755);
console.log(`已生成 ${path.relative(root, outFile)}`);
