#!/usr/bin/env bash

set -euo pipefail

# 计算当前构建的运行时版本号, 供 just dist 与 CI 注入 PROJECT_BUILD_VERSION.
#
# 输出不带前导 v, 例如 0.5.0 / 0.5.0-a1b2c3d / 0.5.0^a1b2c3d.
# 规则: HEAD 恰好是版本 tag 时输出该 tag, 否则在最近版本 tag 后追加 7 位短 hash,
# 工作区有未提交改动时改用 ^ 分隔. 没有版本 tag 时回退到 package.json 的 version.
#
# 依赖 git 与 jq, 需要在仓库内执行:
#   bash scripts/build-version.sh
PACKAGE_NAME="pinote"
TAG_PREFIX="v"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

git_output() {
  local output
  if ! output="$(git "$@" 2>/dev/null)"; then
    return 1
  fi
  output="$(printf '%s' "$output" | tr -d '\r')"
  output="${output#"${output%%[![:space:]]*}"}"
  output="${output%"${output##*[![:space:]]}"}"
  [[ -n "$output" ]] || return 1
  printf '%s\n' "$output"
}

select_version_tag() {
  local tags="$1"
  local line
  if [[ -n "$TAG_PREFIX" ]]; then
    while IFS= read -r line; do
      if [[ "$line" == "$TAG_PREFIX"* ]]; then
        printf '%s\n' "$line"
        return 0
      fi
    done <<< "$tags"
  fi
  while IFS= read -r line; do
    if [[ -n "$line" ]]; then
      printf '%s\n' "$line"
      return 0
    fi
  done <<< "$tags"
  return 1
}

# 用 package.json 的结构化字段读取稳定包版本, 不要正则扫清单文件.
read_package_version() {
  jq -er '.version' package.json
}

describe_latest_tag() {
  if [[ -n "$TAG_PREFIX" ]]; then
    git_output describe --tags --abbrev=0 --match "${TAG_PREFIX}*" HEAD
  else
    git_output describe --tags --abbrev=0 HEAD
  fi
}

strip_tag_prefix() {
  local display="$1"
  if [[ -n "$TAG_PREFIX" && "$display" == "$TAG_PREFIX"* ]]; then
    printf '%s\n' "${display#"$TAG_PREFIX"}"
  else
    printf '%s\n' "$display"
  fi
}

fallback_tag="${TAG_PREFIX}$(read_package_version)"

exact_tag=""
if tags="$(git_output tag --points-at HEAD)"; then
  exact_tag="$(select_version_tag "$tags" || true)"
fi

if [[ -n "$exact_tag" ]]; then
  tag="$exact_tag"
else
  tag="$(describe_latest_tag || true)"
  tag="${tag:-$fallback_tag}"
fi

commit="$(git_output rev-parse --short=7 HEAD || true)"
dirty=false
if [[ -n "$commit" ]]; then
  set +e
  git diff-index --quiet HEAD --
  status=$?
  set -e
  if [[ "$status" -eq 1 ]]; then
    dirty=true
  fi
fi

if [[ -z "$commit" ]]; then
  display="$tag"
elif [[ "$dirty" == true ]]; then
  display="${tag}^${commit}"
elif [[ -n "$exact_tag" ]]; then
  display="$tag"
else
  display="${tag}-${commit}"
fi

strip_tag_prefix "$display"
