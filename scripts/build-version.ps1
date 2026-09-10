$ErrorActionPreference = "Stop"
# git 的失败退出码在 Get-GitOutput 里显式判定, 不让 PowerShell 7.3+ 把它当成终止性错误.
$PSNativeCommandUseErrorActionPreference = $false

# 计算当前构建的运行时版本号, 供 just dist 与 CI 注入 PROJECT_BUILD_VERSION.
#
# 输出不带前导 v, 例如 0.5.0 / 0.5.0-a1b2c3d / 0.5.0^a1b2c3d.
# 规则: HEAD 恰好是版本 tag 时输出该 tag, 否则在最近版本 tag 后追加 7 位短 hash,
# 工作区有未提交改动时改用 ^ 分隔. 没有版本 tag 时回退到 package.json 的 version.
#
# 依赖 git, 需要在仓库内执行:
#   powershell -File scripts/build-version.ps1
$PackageName = "pinote"
$TagPrefix = "v"

$root = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $root
try {

function Get-GitOutput {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$GitArgs
    )

    $output = & git @GitArgs 2>$null
    if ($LASTEXITCODE -ne 0) {
        return $null
    }

    $text = (($output | Out-String) -replace "`r", "").Trim()
    if ([string]::IsNullOrWhiteSpace($text)) {
        return $null
    }

    return $text
}

function Select-VersionTag {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Tags
    )

    $lines = $Tags -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
    if ($TagPrefix) {
        $prefixed = $lines | Where-Object { $_.StartsWith($TagPrefix) } | Select-Object -First 1
        if ($prefixed) {
            return $prefixed
        }
    }

    return $lines | Select-Object -First 1
}

# 用 package.json 的结构化字段读取稳定包版本, 不要正则扫清单文件.
function Read-PackageVersion {
    $manifestPath = Join-Path $root "package.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "缺少 package.json: $manifestPath"
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $packageVersion = $manifest.version
    if (-not $packageVersion) {
        throw "failed to resolve $PackageName version from package.json"
    }
    return $packageVersion
}

function Get-LatestDescribedTag {
    if ($TagPrefix) {
        return Get-GitOutput -GitArgs @("describe", "--tags", "--abbrev=0", "--match", "$TagPrefix*", "HEAD")
    }
    return Get-GitOutput -GitArgs @("describe", "--tags", "--abbrev=0", "HEAD")
}

function Strip-TagPrefix {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Display
    )

    if ($TagPrefix -and $Display.StartsWith($TagPrefix)) {
        return $Display.Substring($TagPrefix.Length)
    }
    return $Display
}

$fallbackTag = "$TagPrefix$(Read-PackageVersion)"
$exactTag = $null
$tags = Get-GitOutput -GitArgs @("tag", "--points-at", "HEAD")
if ($tags) {
    $exactTag = Select-VersionTag -Tags $tags
}

if ($exactTag) {
    $tag = $exactTag
} else {
    $described = Get-LatestDescribedTag
    if ($described) {
        $tag = $described
    } else {
        $tag = $fallbackTag
    }
}

$commit = Get-GitOutput -GitArgs @("rev-parse", "--short=7", "HEAD")
$dirty = $false
if ($commit) {
    & git diff-index --quiet HEAD -- | Out-Null
    if ($LASTEXITCODE -eq 1) {
        $dirty = $true
    }
}

if (-not $commit) {
    $display = $tag
} elseif ($dirty) {
    $display = "$tag^$commit"
} elseif ($exactTag) {
    $display = $tag
} else {
    $display = "$tag-$commit"
}

Write-Output (Strip-TagPrefix -Display $display)
} finally {
    Pop-Location
}
