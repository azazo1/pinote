// Windows 安装策略: 解包归档后交给一个脱离进程的 PowerShell 脚本完成目录替换.
//
// windows 会锁住正在运行的 exe 与其同目录的资源文件, 无法像 linux 那样在进程内让位,
// 所以脚本先等旧进程退出, 再整目录 rename 换位, 失败时回滚并重新拉起原版本.

import { closeSync, openSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { powerShellSingleQuote } from "./escaping.mjs";

export const APPLY_SCRIPT_NAME = "apply-update.ps1";

export function buildWindowsApplyScript({
  pid,
  appDir,
  exeName,
  stagingPath,
  backupPath,
  logPath,
  resultPath,
  quitTimeoutSeconds = 60,
}) {
  return `$ErrorActionPreference = 'Stop'

$TargetPid = ${Number(pid) || 0}
$AppDir = ${powerShellSingleQuote(appDir)}
$ExeName = ${powerShellSingleQuote(exeName)}
$Staging = ${powerShellSingleQuote(stagingPath)}
$Backup = ${powerShellSingleQuote(backupPath)}
$Log = ${powerShellSingleQuote(logPath)}
$Result = ${powerShellSingleQuote(resultPath)}

function Write-Log($message) {
  Add-Content -LiteralPath $Log -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message)
}

function Fail($message) {
  Write-Log ("失败: " + $message)
  Set-Content -LiteralPath $Result -Value $message -Encoding UTF8
  if ((Test-Path -LiteralPath $Backup) -and -not (Test-Path -LiteralPath $AppDir)) {
    Move-Item -LiteralPath $Backup -Destination $AppDir -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $Staging) {
    Remove-Item -LiteralPath $Staging -Recurse -Force -ErrorAction SilentlyContinue
  }
  $exe = Join-Path $AppDir $ExeName
  if (Test-Path -LiteralPath $exe) {
    Start-Process -FilePath $exe
  }
  exit 1
}

Write-Log "等待旧进程退出"
$deadline = (Get-Date).AddSeconds(${quitTimeoutSeconds})
while ((Get-Process -Id $TargetPid -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) {
  Start-Sleep -Milliseconds 500
}
if (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue) {
  Write-Log "旧进程未按时退出"
  Set-Content -LiteralPath $Result -Value "旧进程没有按时退出, 应用仍在运行, 请稍后重新发起更新." -Encoding UTF8
  exit 1
}

$probe = Join-Path $AppDir '.pinote-write-test'
try {
  New-Item -ItemType File -Path $probe -Force | Out-Null
  Remove-Item -LiteralPath $probe -Force
} catch {
  Fail "目标目录不可写, 请重新运行安装包或手动解压替换."
}

if (Test-Path -LiteralPath $Backup) {
  Remove-Item -LiteralPath $Backup -Recurse -Force -ErrorAction SilentlyContinue
}
try {
  Move-Item -LiteralPath $AppDir -Destination $Backup -Force
} catch {
  Fail ("无法让位当前应用目录: " + $_.Exception.Message)
}
try {
  Move-Item -LiteralPath $Staging -Destination $AppDir -Force
} catch {
  Write-Log ("替换失败: " + $_.Exception.Message)
  Move-Item -LiteralPath $Backup -Destination $AppDir -Force -ErrorAction SilentlyContinue
  Fail "替换应用目录失败, 已回滚, 请手动替换."
}
Remove-Item -LiteralPath $Backup -Recurse -Force -ErrorAction SilentlyContinue

Write-Log "替换完成, 重新拉起应用"
Start-Process -FilePath (Join-Path $AppDir $ExeName)
exit 0
`;
}

export function startWindowsHandoff({ scriptPath, script, logPath = null }) {
  // PowerShell 5.1 按 ANSI 解释无 BOM 的脚本, 带上 BOM 才不会让中文变乱码.
  writeFileSync(scriptPath, `\uFEFF${script}`, "utf8");
  let descriptor = null;
  let stdio = "ignore";
  if (logPath) {
    descriptor = openSync(logPath, "a");
    stdio = ["ignore", descriptor, descriptor];
  }
  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", scriptPath,
  ], { detached: true, stdio, windowsHide: true });
  child.unref();
  if (descriptor !== null) closeSync(descriptor);
  return child.pid ?? null;
}
