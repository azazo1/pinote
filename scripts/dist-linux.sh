#!/usr/bin/env bash
# 生成 linux 发布产物 (tar.gz).
#
# 用法:
#   PROJECT_BUILD_VERSION=v0.5.0 bash scripts/dist-linux.sh
#   通常经 just dist / just fake-dist 注入版本号后调用.
#
# 步骤: bun run build → bun run icons → bun run version:embed → electron-builder --dir 产出便携目录
#       → 校验 ELF 可执行文件 → 打成契约命名的 tar.gz → 校验归档顶层结构 → 清理 release/.
# 产出: release/pinote-<version>-linux-<arch>.tar.gz
#       fake 构建为 release/pinote-v0.0.0-linux-<arch>-fake.tar.gz
#
# 归档顶层直接是 release/linux-unpacked 的内容, 不额外套一层目录, 客户端解包后整目录换位替换.
# 只构建运行平台自身的架构 (uname -m), 不同架构由 CI 的独立 runner 负责, 不做交叉打包.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

: "${PROJECT_BUILD_VERSION:?需要设置 PROJECT_BUILD_VERSION, 例如 v0.5.0}"

shopt -s nullglob

case "$(uname -m)" in
  x86_64 | amd64)
    arch="x86_64"
    electron_arch="x64"
    ;;
  arm64 | aarch64)
    arch="aarch64"
    electron_arch="arm64"
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

echo "== linux 打包: 版本 $PROJECT_BUILD_VERSION, 架构 $arch"

bun run build
bun run icons
bun run version:embed

rm -rf release

bunx electron-builder --linux --dir "--$electron_arch" --publish never

payload="release/linux-unpacked"
executable="$payload/pinote"
if [[ ! -d "$payload" ]]; then
  echo "缺少 electron-builder 便携目录: $payload" >&2
  exit 1
fi
if [[ ! -x "$executable" ]]; then
  echo "缺少可执行文件: $executable" >&2
  exit 1
fi
if ! file "$executable" | grep -q "ELF"; then
  echo "不是 ELF 可执行文件: $executable" >&2
  exit 1
fi

name="$(bun scripts/dist-artifacts.mjs name --platform linux --arch "$arch")"

top_entries=()
while IFS= read -r entry; do
  top_entries+=("$entry")
done < <(cd "$payload" && ls -A)

tar -czf "release/$name" -C "$payload" -- "${top_entries[@]}"

expected_top="$(printf '%s\n' "${top_entries[@]}" | sort)"
actual_top="$(tar -tzf "release/$name" | cut -d/ -f1 | sort -u | grep -v '^$' || true)"
if [[ "$expected_top" != "$actual_top" ]]; then
  echo "归档顶层与 $payload 内容不一致:" >&2
  diff <(printf '%s\n' "$expected_top") <(printf '%s\n' "$actual_top") >&2 || true
  exit 1
fi
echo "== 归档命名: release/$name, 顶层 ${#top_entries[@]} 个条目"

bun scripts/dist-artifacts.mjs finalize --platform linux --arch "$arch"
