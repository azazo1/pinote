// 发布产物命名与 release/ 目录收尾, 由平台打包脚本调用, 保证三个平台用同一套命名规则.
//
// 命名契约: <app>-<version>-<platform>-<arch>.<ext>
//   platform ∈ macos | windows | linux
//   arch ∈ x86_64 | aarch64
//   ext: macos → dmg, windows → zip, linux → tar.gz
//   version 取 PROJECT_BUILD_VERSION 去掉前导 v, 例如 pinote-0.5.0-linux-x86_64.tar.gz.
//   fake 构建 (just fake-dist) 的版本固定 v0.0.0, 按字面保留 v 并在末尾追加 -fake,
//   例如 pinote-v0.0.0-linux-x86_64-fake.tar.gz.
//
// 用法 (平台脚本内部调用):
//   bun scripts/dist-artifacts.mjs name --platform linux --arch aarch64
//   bun scripts/dist-artifacts.mjs finalize --platform linux --arch aarch64
//
// name 打印契约命名的归档文件名; finalize 校验该归档已生成, 清掉 release/ 中的
// electron-builder 默认命名产物与中间目录, 再打印最终产物清单与数量, 缺文件时以非 0 退出.
// SHA256SUMS 由 release job 对全部平台的归档统一生成, 不在这里处理.
//
// 环境变量:
//   PROJECT_BUILD_VERSION 必填, 由 scripts/build-version.* 产出并经 just dist / CI 注入.
//   PROJECT_DIST_FAKE     非空且不为 0 时按 fake 构建命名, 要求版本恰为 v0.0.0.
//   PROJECT_DIST_ARCH     可选, CI 传入矩阵架构, 与本机推导的架构不一致时直接失败.

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const APP = "pinote";
const EXTENSIONS = { macos: "dmg", windows: "zip", linux: "tar.gz" };
const ARCHES = new Set(["x86_64", "aarch64"]);
const FAKE_VERSION = "v0.0.0";
const VERSION_PATTERN = /^v?[0-9][0-9A-Za-z.+^-]*$/;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");

function fail(message) {
  console.error(`错误: ${message}`);
  process.exit(1);
}

function readOptions() {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (command !== "name" && command !== "finalize") {
    fail("用法: bun scripts/dist-artifacts.mjs <name|finalize> --platform <platform> --arch <arch>");
  }

  const options = {};
  while (args.length > 0) {
    const flag = args.shift();
    const value = args.shift();
    if (!flag?.startsWith("--") || value === undefined) {
      fail(`无法解析参数: ${flag ?? ""}`);
    }
    options[flag.slice(2)] = value;
  }

  const platform = options.platform;
  if (!Object.hasOwn(EXTENSIONS, platform ?? "")) {
    fail(`platform 必须是 macos / windows / linux, 当前为 ${platform ?? "空"}`);
  }

  const arch = options.arch;
  if (!ARCHES.has(arch ?? "")) {
    fail(`arch 必须是 x86_64 / aarch64, 当前为 ${arch ?? "空"}`);
  }

  const expectedArch = process.env.PROJECT_DIST_ARCH?.trim() ?? "";
  if (expectedArch && expectedArch !== arch) {
    fail(`期望架构 ${expectedArch} 与本机推导的架构 ${arch} 不一致`);
  }

  const rawVersion = process.env.PROJECT_BUILD_VERSION?.trim() ?? "";
  if (rawVersion.length === 0) {
    fail("需要设置 PROJECT_BUILD_VERSION, 例如 v0.5.0");
  }
  if (!VERSION_PATTERN.test(rawVersion)) {
    fail(`PROJECT_BUILD_VERSION 格式非法: ${rawVersion}`);
  }

  const fakeValue = process.env.PROJECT_DIST_FAKE?.trim() ?? "";
  const fake = fakeValue.length > 0 && fakeValue !== "0";
  if (fake && rawVersion !== FAKE_VERSION) {
    fail(`fake 构建的 PROJECT_BUILD_VERSION 必须是 ${FAKE_VERSION}, 当前为 ${rawVersion}`);
  }

  // 正式产物去掉前导 v, fake 产物按字面保留 v0.0.0 区分测试构建.
  const version = fake ? rawVersion : rawVersion.replace(/^v/, "");
  const suffix = fake ? "-fake" : "";
  const name = `${APP}-${version}-${platform}-${arch}${suffix}.${EXTENSIONS[platform]}`;

  return { command, platform, arch, name };
}

function listReleaseDir() {
  if (!existsSync(releaseDir)) return [];
  return readdirSync(releaseDir, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort();
}

function finalize(name) {
  const archivePath = path.join(releaseDir, name);
  if (!existsSync(archivePath) || !statSync(archivePath).isFile()) {
    fail(`缺少预期归档 release/${name}, 当前 release/ 内容: ${listReleaseDir().join(", ") || "空"}`);
  }
  if (statSync(archivePath).size === 0) {
    fail(`预期归档为空文件: release/${name}`);
  }

  const removed = [];
  for (const entry of listReleaseDir()) {
    if (entry === name) continue;
    rmSync(path.join(releaseDir, entry), { recursive: true, force: true });
    removed.push(entry);
  }

  const files = listReleaseDir();
  console.log(`release/ 清理完成, 移除 ${removed.length} 个非契约条目: ${removed.join(", ") || "无"}`);
  console.log(`release/ 最终产物 ${files.length} 个:`);
  for (const file of files) {
    console.log(`  ${file} (${statSync(path.join(releaseDir, file)).size} 字节)`);
  }

  if (files.length !== 1 || files[0] !== name) {
    fail(`release/ 最终应只保留 ${name}, 实际为 ${files.join(", ") || "空"}`);
  }
}

const { command, name } = readOptions();
if (command === "name") {
  console.log(name);
} else {
  finalize(name);
}
