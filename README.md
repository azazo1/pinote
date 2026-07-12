# Pinote

Pinote 是一款轻量的桌面便签应用, 支持主窗口管理, 便签分组和 tags, Markdown 实时预览, Emacs 光标操作, 多窗口置顶和侧边聚群.

桌面客户端支持 macOS, Windows 和 Linux. macOS 可与全屏空间共存. Windows 支持普通全屏和无边框全屏应用上的置顶, 但不保证覆盖独占全屏程序. Linux X11 支持完整的窗口移动与侧边便签架, Wayland 会按合成器能力降级置顶, 并使用窗口内紧凑列表代替强制移动窗口.

## 开发

```shell
bun install
just dev
```

双击便签顶栏可收起或展开, 拖动顶栏可移动窗口. 浮动便签接近其他便签或当前屏幕边缘时会自动对齐并贴靠, 鼠标靠近侧边球时会缩向球心预览, 松手后确认收纳. 在 macOS 全屏空间中, 便签以辅助窗口共存, 不会挤压全屏应用. 每张便签可以独立收纳到侧边, 直接拖动侧边架中的便签条即可从球中展开并移出, 拖回架内会在光标位置恢复便签条并取消移出. 半圆把手可以沿屏幕右侧拖动并按显示器记住位置, 鼠标离开把手和展开便签后会短暂延迟再收回.

应用启动后先显示主窗口, 空数据不会自动创建便签. 主窗口可以搜索, 新建, 打开和删除便签, 并按分组或多个 tags 的交集筛选列表. 每张便签可以设置分组, 添加手动 tag, 或复用已有的分组和 tags. 红色关闭按钮会直接将主窗口隐藏到系统 Tray, 不退出应用; 最小化按钮保留系统原生行为. 点击 Tray 图标可以重新打开主窗口. 便签右上角的关闭按钮只关闭窗口并保留内容, 之后可以从主窗口重新打开. 删除和云同步位于便签右下角的三点菜单中.

Markdown 编辑器会在光标所在行显示原始标记, 其他行直接显示实时排版效果. 在正文输入 `#tag` 会自动创建对应 tag, 并像 Obsidian 一样在编辑器中高亮; 从正文移除后会同步更新自动 tags. 任务列表始终显示可点击复选框并隐藏原始标记. 首版 Emacs 光标操作包括 `Ctrl+A/E/B/F/P/N`, macOS 的 `Cmd` 快捷键保持系统原义.

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

同步服务使用 Rust, Axum 和 SQLite WAL. 服务提供 `/healthz` 和 `/readyz` 探针, 默认监听容器内的 `8787` 端口.

### Compose 便携部署

仓库根目录的 `compose.yml` 使用 `./data` 保存 SQLite 数据, 使用 `./secrets/pinote-token` 保存访问令牌. 部署状态全部位于普通目录中, 可以直接备份或迁移, 不依赖 Docker 命名卷.

首次构建需要完整仓库. 构建完成后可以导出镜像, 目标服务器不需要安装 Rust 或 Bun.

```shell
umask 077
mkdir -p data secrets
cp .env.example .env
openssl rand -hex 32 > secrets/pinote-token
docker compose -p pinote --env-file .env -f compose.yml config --quiet
```

Linux 服务器上的容器使用 UID `10001`. 首次启动前需要调整数据目录所有者. Docker Desktop 用户可以跳过这一步.

```shell
sudo chown -R 10001:10001 data
```

构建本机架构的镜像并启动服务.

```shell
docker build --file server/Dockerfile --tag pinote-sync-server:local .
docker compose -p pinote --env-file .env -f compose.yml up -d
```

检查容器状态, 日志和就绪探针.

```shell
docker compose -p pinote --env-file .env -f compose.yml ps
docker compose -p pinote --env-file .env -f compose.yml logs --tail=100 sync-server
curl --fail --show-error http://127.0.0.1:8787/readyz
```

如果修改了 `.env` 中的 `PINOTE_PORT`, `curl` 和桌面客户端地址也需要使用新的宿主机端口. 远程客户端不能填写 `127.0.0.1`, 应填写服务器局域网地址或 HTTPS 域名.

### 迁移与备份

迁移前先停止服务, 避免在 SQLite WAL 写入期间复制文件. 数据归档包含访问令牌, 应通过加密通道传输并限制读取权限.

```shell
docker compose -p pinote --env-file .env -f compose.yml down
docker save pinote-sync-server:local | gzip > pinote-sync-server-image.tar.gz
sudo tar -czf pinote-sync-data.tar.gz compose.yml .env data secrets
sudo chown "$(id -u):$(id -g)" pinote-sync-data.tar.gz
chmod 600 pinote-sync-data.tar.gz
```

在目标服务器解压数据并载入镜像, 然后使用 `--no-build` 启动. 解压后需要恢复部署文件和数据目录的所有者.

```shell
sudo tar -xzf pinote-sync-data.tar.gz
sudo chown "$(id -u):$(id -g)" compose.yml .env
sudo chown -R "$(id -u):$(id -g)" secrets
gzip -dc pinote-sync-server-image.tar.gz | docker load
sudo chown -R 10001:10001 data
docker compose -p pinote --env-file .env -f compose.yml up --no-build -d
```

确认新服务器就绪后再删除旧服务器的数据. `docker compose down` 不会删除 `./data`, 只有手动删除部署目录才会删除同步数据库.

### 更新与令牌轮换

从仓库更新服务端后重新构建镜像和容器.

```shell
docker build --file server/Dockerfile --tag pinote-sync-server:local .
docker compose -p pinote --env-file .env -f compose.yml up -d
```

轮换令牌后需要强制重建服务容器, 并在每台桌面客户端中填写新令牌.

```shell
umask 077
openssl rand -hex 32 > secrets/pinote-token
docker compose -p pinote --env-file .env -f compose.yml up -d --force-recreate sync-server
```

令牌文件只能包含令牌本身, 不要写成 `KEY=value`. 不要提交 `.env`, `data` 或 `secrets` 目录. 公网部署必须在服务前配置 HTTPS 反向代理和防火墙, 不应直接暴露明文 HTTP.

### 从源码直接运行

不使用容器时可以通过 `just` 启动服务.

```shell
just sync-server ./secrets/pinote-token --host 0.0.0.0 --port 8787 --data-dir ./data
```

从便签三点菜单或主窗口打开云同步, 填写服务地址和相同令牌即可连接.
