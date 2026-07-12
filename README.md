# Pinote

Pinote 是一款轻量的桌面便签应用, 支持 Markdown 实时预览, Emacs 光标操作, 多窗口置顶和侧边聚群.

桌面客户端支持 macOS, Windows 和 Linux. macOS 可与全屏空间共存. Windows 支持普通全屏和无边框全屏应用上的置顶, 但不保证覆盖独占全屏程序. Linux X11 支持完整的窗口移动与侧边便签架, Wayland 会按合成器能力降级置顶, 并使用窗口内紧凑列表代替强制移动窗口.

## 开发

```shell
bun install
just dev
```

双击便签顶栏可收起或展开, 拖动顶栏可移动窗口. 在 macOS 全屏空间中, 便签以浮动窗口共存, 不会挤压全屏应用.

Markdown 编辑器会在光标所在行显示原始标记, 其他行直接显示实时排版效果. 首版 Emacs 光标操作包括 `Ctrl+A/E/B/F/P/N`, macOS 的 `Cmd` 快捷键保持系统原义.

## 桌面安装包

electron-builder 会先从 `build/icon-source.svg` 生成各平台需要的图标, 再把 Vite 产物和 Electron 主进程代码封装为安装包.

```shell
just dist-mac
just dist-win
just dist-linux
```

macOS 产物为 arm64 和 x64 DMG, Windows 产物为 x64 NSIS 安装器, Linux 产物为 x64 AppImage 和 deb. 文件统一写入 `release/`. 这些首版产物没有 Apple 公证或 Windows 代码签名, 安装时可能触发系统安全提示.

日常开发可以运行 `just dist` 只构建当前平台的默认目标. GitHub Actions 会在 macOS, Windows 和 Ubuntu runner 上分别执行测试与原生打包, 不使用交叉编译.

## 自托管同步

同步服务使用 Rust, Axum 和 SQLite WAL. 首次启动前创建一个只包含访问令牌的文件, 再把同一令牌填写到桌面客户端的同步设置中.

```shell
just sync-server ./secrets/pinote-token --host 0.0.0.0 --port 8787 --data-dir ./data
```

也可以使用 Docker Compose 启动服务. `.env.example` 列出了端口, 数据目录和令牌文件变量, SQLite 数据目录会挂载到持久卷.

```shell
docker compose up --build -d
```

服务提供 `/healthz` 和 `/readyz` 探针. 在便签底部打开云朵按钮, 填写服务地址和相同令牌即可连接. 公网部署时应在服务前配置 HTTPS 反向代理, 并使用足够长的随机令牌.
