# 列出可用 recipe.
[private]
default:
    @just --list

# 启动开发模式.
dev:
    bun run dev

# 启动隔离数据目录与日志的调试实例.
debug:
    mkdir -p target/pinote-debug && PINOTE_USER_DATA=target/pinote-debug PINOTE_LOG_FILE=target/pinote-debug/pinote.log PINOTE_LOG_LEVEL=trace bun run dev

# 构建并校验类型.
build:
    bun run build

# 根据当前平台生成发布产物.
[macos]
dist:
    PROJECT_BUILD_VERSION="${PROJECT_BUILD_VERSION:-v$(bash scripts/build-version.sh)}" bash scripts/dist-macos.sh

# 根据当前平台生成发布产物.
[linux]
dist:
    PROJECT_BUILD_VERSION="${PROJECT_BUILD_VERSION:-v$(bash scripts/build-version.sh)}" bash scripts/dist-linux.sh

# 根据当前平台生成发布产物.
[windows]
[script('powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File')]
dist:
    $ErrorActionPreference = 'Stop'
    if (-not $env:PROJECT_BUILD_VERSION) {
        $version = (& 'scripts/build-version.ps1' | Out-String).Trim()
        $env:PROJECT_BUILD_VERSION = "v$version"
    }
    & 'scripts/dist-windows.ps1'
    if ($LASTEXITCODE) { exit $LASTEXITCODE }

# 生成专用于自动更新测试的 fake 构建, 版本固定 v0.0.0 且产物名追加 -fake, 只在本地使用.
[macos]
fake-dist:
    PROJECT_BUILD_VERSION=v0.0.0 PROJECT_DIST_FAKE=1 bash scripts/dist-macos.sh

# 生成专用于自动更新测试的 fake 构建, 版本固定 v0.0.0 且产物名追加 -fake, 只在本地使用.
[linux]
fake-dist:
    PROJECT_BUILD_VERSION=v0.0.0 PROJECT_DIST_FAKE=1 bash scripts/dist-linux.sh

# 生成专用于自动更新测试的 fake 构建, 版本固定 v0.0.0 且产物名追加 -fake, 只在本地使用.
[windows]
[script('powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File')]
fake-dist:
    $ErrorActionPreference = 'Stop'
    $env:PROJECT_BUILD_VERSION = 'v0.0.0'
    $env:PROJECT_DIST_FAKE = '1'
    & 'scripts/dist-windows.ps1'
    if ($LASTEXITCODE) { exit $LASTEXITCODE }

# 运行关键功能测试.
test:
    bun run test

# 运行桌面端 Playwright 测试, 需要沙箱外执行.
test-electron:
    bun run test:electron

# 启动自托管同步服务.
sync-server *args:
    cargo run --manifest-path server/Cargo.toml -- {{args}}
