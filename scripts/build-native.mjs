#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 编译 macOS 的两个原生产物:
// - mac-modifier-state: 修饰键状态轮询 helper (子进程).
// - pinote-ax.node: 主进程里读取文本插入点的 N-API 模块 (辅助功能授权作用于 Pinote).
// 其他平台不需要这些产物. 缺少工具链或 Node 头文件时给出警告并跳过.

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(currentDir, "..");

if (process.platform !== "darwin") {
  console.log("当前平台不需要构建 macOS 原生产物, 跳过");
  process.exit(0);
}

const outDir = path.join(root, "build", "generated");
const helperSource = path.join(root, "native", "mac-modifier-state", "main.c");
const helperOut = path.join(outDir, "mac-modifier-state");
const axSource = path.join(root, "native", "mac-ax", "pinote-ax.c");
const axOut = path.join(outDir, "pinote-ax.node");

if (!existsSync(helperSource) || !existsSync(axSource)) {
  console.error("找不到原生源码");
  process.exit(1);
}

let clang;
try {
  clang = execFileSync("xcrun", ["--find", "clang"], { encoding: "utf8" }).trim();
} catch {
  console.warn("未找到 clang, 跳过 macOS 原生构建; 便签避让与光标避让将不可用");
  process.exit(0);
}

let sdk = null;
try {
  sdk = execFileSync("xcrun", ["--sdk", "macosx", "--show-sdk-path"], { encoding: "utf8" }).trim() || null;
} catch {
  sdk = null;
}

mkdirSync(outDir, { recursive: true });
execFileSync(clang, [
  "-O2",
  ...(sdk ? ["-isysroot", sdk] : []),
  "-framework", "ApplicationServices",
  helperSource,
  "-o", helperOut,
], { stdio: "inherit" });
chmodSync(helperOut, 0o755);
console.log(`已生成 ${path.relative(root, helperOut)}`);

const headerCandidates = [
  process.env.NODE_HEADERS,
  "/opt/homebrew/include/node",
  "/usr/local/include/node",
  "/opt/local/include/node",
].filter((candidate) => candidate && existsSync(path.join(candidate, "node_api.h")));
if (headerCandidates.length === 0) {
  // 占位, 保证打包配置里的文件存在; 运行时加载失败只会禁用光标避让.
  writeFileSync(axOut, "");
  console.warn("未找到 Node 头文件 (设置 NODE_HEADERS 或安装 node 开发头), 跳过 pinote-ax 编译; 光标避让将不可用");
  process.exit(0);
}
execFileSync(clang, [
  "-bundle",
  "-undefined", "dynamic_lookup",
  "-O2",
  ...(sdk ? ["-isysroot", sdk] : []),
  "-I", headerCandidates[0],
  "-framework", "ApplicationServices",
  axSource,
  "-o", axOut,
], { stdio: "inherit" });
console.log(`已生成 ${path.relative(root, axOut)} (headers: ${headerCandidates[0]})`);
