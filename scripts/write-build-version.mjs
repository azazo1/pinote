// 把构建版本写入 build/generated/build-version.json.
//
// 发布打包脚本在调用 electron-builder 之前执行本脚本, 通过 PROJECT_BUILD_VERSION
// 环境变量传入 scripts/build-version.sh 或 scripts/build-version.ps1 的结果.
// 普通开发构建不传环境变量, 落盘为 dev-build, 运行时据此显示 dev-build.
//
// 用法:
//   bun scripts/write-build-version.mjs
//   PROJECT_BUILD_VERSION=v0.5.0 bun scripts/write-build-version.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEV_BUILD = "dev-build";
const OUTPUT = path.join("build", "generated", "build-version.json");

const raw = process.env.PROJECT_BUILD_VERSION?.trim() ?? "";
const version = raw.length > 0 ? raw : DEV_BUILD;

mkdirSync(path.dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify({ version }, null, 2)}\n`, "utf8");
console.log(`构建版本已写入 ${OUTPUT}: ${version}`);
