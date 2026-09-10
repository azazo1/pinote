$ErrorActionPreference = "Stop"
# 外部命令的退出码在 Invoke-Bun 里显式判定, 不让 PowerShell 7.3+ 把它当成终止性错误.
$PSNativeCommandUseErrorActionPreference = $false

# 生成 windows 发布产物 (zip).
#
# 用法:
#   $env:PROJECT_BUILD_VERSION = "v0.5.0"
#   pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/dist-windows.ps1
#   通常经 just dist / just fake-dist 注入版本号后调用.
#
# 步骤: bun run build → bun run icons → bun run version:embed → electron-builder --dir 产出便携目录
#       → 校验 PE 可执行文件 → 打成契约命名的 zip → 校验归档顶层结构 → 清理 release/.
# 产出: release/pinote-<version>-windows-<arch>.zip
#       fake 构建为 release/pinote-v0.0.0-windows-<arch>-fake.zip
#
# 归档顶层直接是 electron-builder 便携目录的内容, 不额外套一层目录, 客户端解包后整目录换位替换.
# x64 为 release/win-unpacked, 其他架构为 release/win-<electronArch>-unpacked.
# zip 条目统一使用 / 分隔符, 避免 Expand-Archive 在 windows 上还原出带反斜杠的文件名.
# 只构建运行平台自身的架构 (PROCESSOR_ARCHITECTURE), 不做交叉打包.

$root = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $root
try {

function Invoke-Bun {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & bun @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "bun $($Arguments -join ' ') 失败, 退出码 $LASTEXITCODE"
    }
}

$buildVersion = $env:PROJECT_BUILD_VERSION
if ([string]::IsNullOrWhiteSpace($buildVersion)) {
    throw "需要设置 PROJECT_BUILD_VERSION, 例如 v0.5.0"
}

switch ($env:PROCESSOR_ARCHITECTURE) {
    "AMD64" {
        $arch = "x86_64"
        $electronArch = "x64"
    }
    "ARM64" {
        $arch = "aarch64"
        $electronArch = "arm64"
    }
    default {
        throw "不支持的运行架构: $env:PROCESSOR_ARCHITECTURE"
    }
}

if ($env:PROJECT_DIST_ARCH -and $env:PROJECT_DIST_ARCH -ne $arch) {
    throw "期望架构 $env:PROJECT_DIST_ARCH 与运行平台架构 $arch 不一致"
}

Write-Output "== windows 打包: 版本 $buildVersion, 架构 $arch"

Invoke-Bun @("run", "build")
Invoke-Bun @("run", "icons")
Invoke-Bun @("run", "version:embed")

$releaseDir = Join-Path $root "release"
if (Test-Path -LiteralPath $releaseDir) {
    Remove-Item -LiteralPath $releaseDir -Recurse -Force
}

# bun x 等同于 bunx, 但不需要依赖 windows 上单独的 bunx 可执行文件.
Invoke-Bun @("x", "electron-builder", "--win", "--dir", "--$electronArch", "--publish", "never")

$payloadName = if ($electronArch -eq "x64") { "win-unpacked" } else { "win-$electronArch-unpacked" }
$payload = Join-Path $releaseDir $payloadName
if (-not (Test-Path -LiteralPath $payload -PathType Container)) {
    $available = @()
    if (Test-Path -LiteralPath $releaseDir) {
        $available = Get-ChildItem -LiteralPath $releaseDir | ForEach-Object { $_.Name }
    }
    throw "缺少 electron-builder 便携目录: $payload, 当前 release/ 内容: $($available -join ', ')"
}

$executable = Join-Path $payload "Pinote.exe"
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "缺少可执行文件: $executable"
}

# PE 文件头检查 (MZ), 不启动 GUI 程序.
$stream = [System.IO.File]::OpenRead($executable)
try {
    $header = New-Object byte[] 2
    $read = $stream.Read($header, 0, 2)
} finally {
    $stream.Dispose()
}
if ($read -ne 2 -or $header[0] -ne 0x4d -or $header[1] -ne 0x5a) {
    throw "PE 文件头无效: $executable"
}

$name = (& bun scripts/dist-artifacts.mjs name --platform windows --arch $arch | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($name)) {
    throw "解析发布产物名称失败"
}

$payloadRoot = (Resolve-Path -LiteralPath $payload).Path
$prefixLength = $payloadRoot.Length + 1
$zipPath = Join-Path $releaseDir $name

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($directory in (Get-ChildItem -LiteralPath $payloadRoot -Recurse -Directory)) {
        $relative = $directory.FullName.Substring($prefixLength).Replace("\", "/") + "/"
        $null = $archive.CreateEntry($relative)
    }
    foreach ($file in (Get-ChildItem -LiteralPath $payloadRoot -Recurse -File)) {
        $relative = $file.FullName.Substring($prefixLength).Replace("\", "/")
        $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive,
            $file.FullName,
            $relative,
            [System.IO.Compression.CompressionLevel]::Optimal
        )
    }
} finally {
    $archive.Dispose()
}

$expectedTop = Get-ChildItem -LiteralPath $payloadRoot | ForEach-Object { $_.Name } | Sort-Object -Unique
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $actualTop = $zip.Entries |
        ForEach-Object { ($_.FullName -split "/")[0] } |
        Where-Object { $_ -ne "" } |
        Sort-Object -Unique
} finally {
    $zip.Dispose()
}
$difference = Compare-Object -ReferenceObject $expectedTop -DifferenceObject $actualTop
if ($difference) {
    throw "归档顶层与 $payload 内容不一致: $($difference | Out-String)"
}
Write-Output "== 归档命名: release/$name, 顶层 $($expectedTop.Count) 个条目"

Invoke-Bun @("scripts/dist-artifacts.mjs", "finalize", "--platform", "windows", "--arch", $arch)
} finally {
    Pop-Location
}
