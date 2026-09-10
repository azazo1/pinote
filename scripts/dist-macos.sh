#!/usr/bin/env bash
# 生成 macOS 发布产物 (dmg).
#
# 用法:
#   PROJECT_BUILD_VERSION=v0.5.0 bash scripts/dist-macos.sh
#   通常经 just dist / just fake-dist 注入版本号后调用.
#
# 步骤: bun run build → bun run icons → bun run version:embed → electron-builder 打 dmg
#       → 校验应用包与主可执行文件 → 按契约重命名 → 清理 release/ 只留契约文件.
# 产出: release/pinote-<version>-macos-<arch>.dmg
#       fake 构建为 release/pinote-v0.0.0-macos-<arch>-fake.dmg
#
# 只构建运行平台自身的架构 (uname -m), 不同架构由 CI 的独立 runner 负责, 不做交叉打包.
# 这里的 dmg 由 electron-builder 原生生成, 内部包含 Pinote.app 与指向 /Applications 的符号链接.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

: "${PROJECT_BUILD_VERSION:?需要设置 PROJECT_BUILD_VERSION, 例如 v0.5.0}"

shopt -s nullglob

case "$(uname -m)" in
  x86_64 | amd64)
    arch="x86_64"
    electron_arch="x64"
    macho_arch="x86_64"
    ;;
  arm64 | aarch64)
    arch="aarch64"
    electron_arch="arm64"
    macho_arch="arm64"
    ;;
  *)
    echo "不支持的运行架构: $(uname -m)" >&2
    exit 1
    ;;
esac

if [[ -n "${PROJECT_DIST_ARCH:-}" && "$PROJECT_DIST_ARCH" != "$arch" ]]; then
  echo "期望架构 $PROJECT_DIST_ARCH 与运行平台架构 $arch 不一致" >&2
  exit 1
fi

echo "== macOS 打包: 版本 $PROJECT_BUILD_VERSION, 架构 $arch"

bun run build
bun run icons
bun run version:embed

rm -rf release

CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac dmg "--$electron_arch" --publish never

apps=(release/mac*/Pinote.app)

validated_app=""
for app in "${apps[@]}"; do
  main_executable="$app/Contents/MacOS/Pinote"
  if [[ -x "$main_executable" ]] && file "$main_executable" | grep -q "$macho_arch"; then
    validated_app="$app"
    break
  fi
done

if [[ -z "$validated_app" ]]; then
  echo "未找到与 $arch 匹配的应用包, 检查 release/mac*/Pinote.app 及其 Contents/MacOS/Pinote" >&2
  exit 1
fi
echo "== 校验应用包: $validated_app"

dmgs=(release/*-"$electron_arch".dmg)
if (( ${#dmgs[@]} != 1 )); then
  echo "预期恰好 1 个 $electron_arch dmg, 实际 ${#dmgs[@]} 个: ${dmgs[*]:-无}" >&2
  exit 1
fi

name="$(bun scripts/dist-artifacts.mjs name --platform macos --arch "$arch")"
mv "${dmgs[0]}" "release/$name"
echo "== 归档命名: release/$name"

bun scripts/dist-artifacts.mjs finalize --platform macos --arch "$arch"
