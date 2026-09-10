// macOS 安装策略: 把替换工作写成一个脱离本进程的脚本并立刻启动它, 自己随即退出.
//
// 直接覆盖运行中的 .app 会被 LaunchServices 拒绝, 所以脚本要等旧进程消失后再挂载 dmg,
// 把新 bundle 复制到同卷暂存路径, 用 rename 完成最后一步替换, 并在任何失败路径上回滚.

import { chmodSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { shellSingleQuote } from "./escaping.mjs";

export const APPLY_SCRIPT_NAME = "apply-update.sh";

export function buildMacApplyScript({
  pid,
  bundlePath,
  dmgPath,
  stagingPath,
  backupPath,
  mountPath,
  logPath,
  resultPath,
  quitTimeoutSeconds = 60,
}) {
  const attempts = Math.max(1, Math.round(quitTimeoutSeconds * 2));
  return `#!/bin/sh
# Pinote 自动更新替换脚本, 由应用生成, 替换完成后可以删除.

trap '' HUP

PID=${shellSingleQuote(pid)}
BUNDLE=${shellSingleQuote(bundlePath)}
DMG=${shellSingleQuote(dmgPath)}
STAGING=${shellSingleQuote(stagingPath)}
BACKUP=${shellSingleQuote(backupPath)}
MOUNT=${shellSingleQuote(mountPath)}
LOG=${shellSingleQuote(logPath)}
RESULT=${shellSingleQuote(resultPath)}

log() {
  printf '%s %s\\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"
}

fail() {
  log "失败: $1"
  printf '%s\\n' "$1" > "$RESULT"
  if [ -d "$BACKUP" ] && [ ! -d "$BUNDLE" ]; then
    mv "$BACKUP" "$BUNDLE" 2>/dev/null
  fi
  [ -d "$MOUNT" ] && hdiutil detach "$MOUNT" >/dev/null 2>&1
  rm -rf "$STAGING" 2>/dev/null
  log "重新拉起原版本"
  open "$BUNDLE" 2>/dev/null
  exit 1
}

log "等待旧进程退出"
ticks=0
while kill -0 "$PID" 2>/dev/null; do
  ticks=$((ticks + 1))
  if [ "$ticks" -gt ${attempts} ]; then
    log "旧进程未在 ${quitTimeoutSeconds} 秒内退出"
    printf '%s\\n' "旧进程没有按时退出, 应用仍在运行, 请稍后重新发起更新." > "$RESULT"
    exit 1
  fi
  sleep 0.5
done

BUNDLE_DIR=$(dirname "$BUNDLE")
if [ ! -w "$BUNDLE_DIR" ]; then
  fail "目标目录不可写, 请手动把 dmg 里的应用拖进 应用程序."
fi

mkdir -p "$MOUNT" 2>/dev/null || fail "无法创建挂载点."
hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MOUNT" >/dev/null 2>&1 || fail "挂载更新镜像失败, 请手动打开 dmg 安装."

SOURCE_APP=$(ls -d "$MOUNT"/*.app 2>/dev/null | head -n 1)
if [ -z "$SOURCE_APP" ]; then
  fail "更新镜像里没有找到应用包, 请手动安装."
fi

rm -rf "$STAGING"
ditto "$SOURCE_APP" "$STAGING" || fail "复制新版本失败, 请手动安装."
xattr -dr com.apple.quarantine "$STAGING" 2>/dev/null

rm -rf "$BACKUP"
mv "$BUNDLE" "$BACKUP" || fail "备份原版本失败, 请手动安装."
if ! mv "$STAGING" "$BUNDLE"; then
  mv "$BACKUP" "$BUNDLE" 2>/dev/null
  fail "替换应用包失败, 已回滚, 请手动安装."
fi
rm -rf "$BACKUP"
hdiutil detach "$MOUNT" >/dev/null 2>&1

log "替换完成, 重新拉起应用"
open "$BUNDLE"
exit 0
`;
}

export function startMacHandoff({ scriptPath, script }) {
  writeFileSync(scriptPath, script, { encoding: "utf8", mode: 0o755 });
  chmodSync(scriptPath, 0o755);
  const child = spawn("/bin/sh", [scriptPath], { detached: true, stdio: "ignore" });
  child.unref();
  return child.pid ?? null;
}
