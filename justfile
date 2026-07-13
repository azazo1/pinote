default:
    @just --list

# 启动开发模式.
dev:
    bun run dev

# 构建并校验类型.
build:
    bun run build

# 生成当前平台的安装包.
dist:
    bun run dist

# 生成 macOS arm64 和 x64 DMG.
dist-mac:
    bun run dist:mac

# 生成 Windows x64 NSIS 安装器.
dist-win:
    bun run dist:win

# 生成 Linux x64 AppImage 和 deb 安装包.
dist-linux:
    bun run dist:linux

# 运行关键功能测试.
test:
    bun run test

# 启动自托管同步服务.
sync-server *args:
    cargo run --manifest-path server/Cargo.toml -- {{args}}
