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

便签三点菜单中的 "仅保留在本机" 可以把便签设为 local only: 此后的修改不再上传云端, 云端和其他设备上的既有副本保持原样, 本地删除也不会同步; 主窗口列表会用 "仅本地" 徽标标记这类便签. 重新选择 "恢复云同步" 后便签回到同步流程, 期间累积的修改会补传, 与其他设备的改动冲突时按既有规则生成冲突副本. 是否仅本地只影响当前设备, 该标记本身不参与同步.

同一数据目录下只允许运行一个实例, 再次启动只会唤起已有窗口. 从终端启动时 `Ctrl+C` 会走和托盘退出相同的收尾流程, 先保存便签再退出.

Markdown 编辑器会在光标所在行显示原始标记, 其他行直接显示实时排版效果. 在正文输入 `#tag` 会自动创建对应 tag, 并像 Obsidian 一样在编辑器中高亮; 从正文移除后会同步更新自动 tags. 任务列表始终显示可点击复选框并隐藏原始标记. 正文没有选区时, `Cmd/Ctrl+C/X` 会直接复制或剪切光标所在行. 首版 Emacs 光标操作包括 `Ctrl+A/E/B/F/P/N`, macOS 的 `Cmd` 快捷键保持系统原义.

## 桌面安装包

electron-builder 会先从 `build/icon-source.svg` 生成各平台需要的图标, 再把 Vite 产物和 Electron 主进程代码封装为发布产物.

```shell
just dist
```

`just dist` 只构建当前运行平台的自身架构, 不做交叉打包; 其他平台由 CI 的独立 runner 负责. 产物统一写入 `release/`, 命名遵循 `<app>-<version>-<platform>-<arch>.<ext>`, 例如 `pinote-0.5.0-macos-aarch64.dmg`, `pinote-0.5.0-windows-x86_64.zip` 和 `pinote-0.5.0-linux-x86_64.tar.gz` (Linux 与 Windows 归档的顶层就是便携应用目录, 客户端整目录替换). 这些首版产物没有 Apple 公证或 Windows 代码签名, 安装时可能触发系统安全提示.

打包时由 `scripts/build-version.sh` / `scripts/build-version.ps1` 从 git 推导构建版本并经 `PROJECT_BUILD_VERSION` 注入, 因此界面显示的版本会带上 commit 后缀; 直接 `just dev` 或 `just build` 的开发构建显示 `dev-build`.

GitHub Actions 在 macOS (x86_64 与 aarch64), Windows (x86_64 与 aarch64), Linux (x86_64 与 aarch64) 的 runner 上分别执行测试与原生打包. 推送 `v*` tag 后会自动创建或更新 GitHub Release, 校验 tag 与 `package.json` 版本一致, 将 annotated tag 描述置于自动生成的变更列表之前, 并对全部归档生成 `SHA256SUMS`.

## 自动更新

安装版与便携版都会检查更新: 启动 5 秒后静默检查一次 (可在托盘菜单, 更新窗口或设置的 "关于" 页关闭), 也可以从托盘菜单, 应用菜单或状态栏主动检查. 下载走系统代理, 校验 `SHA256SUMS` 中的 SHA256 后按平台安装: Linux 在进程内替换自身目录后重启生效; Windows 与 macOS 会交接给脱离进程的替换脚本, 应用退出后再完成目录或 `.app` 替换并重新拉起.

```shell
just fake-dist
```

`just fake-dist` 复用 `just dist` 的打包路径, 但把版本固定为 `v0.0.0` 并在产物名末尾追加 `-fake`. 它使用独立的 `userData` 目录, 因此可以和正式应用同时运行, 用于端到端验证真实更新流程.

## 调试与日志

```shell
just debug
```

`just debug` 以项目内的 `target/pinote-debug/` 作为数据目录启动调试实例, 与日常数据隔离, 同时把日志级别提到最详细档. 日志文件默认位于数据目录的 `logs/pinote.log`, 按每日与单文件大小轮转并限制留存数量, 可用 `PINOTE_LOG_FILE` 与 `PINOTE_LOG_LEVEL` 覆盖. 设置中的 "记录详细日志" 可以临时打开调试级别, 排查完成后建议关闭.

## 自托管同步

同步服务使用 Rust, Axum 和 SQLite WAL. 服务提供 `/healthz` 和 `/readyz` 探针, 默认监听容器内的 `8787` 端口.

### Compose 快速部署

仓库根目录的 `compose.yml` 直接使用 GHCR 中的 `ghcr.io/azazo1/pinote-sync-server:latest` 镜像. 服务器只需 Docker Compose 和这一个文件, 不需要克隆仓库, 安装 Rust 或手工导入镜像.

GitHub Actions 在 `main` 分支通过检查后会发布 `latest` 及 commit SHA 标签. `v*` Git tag 还会发布完整版本号和主次版本号标签. CI 使用 cargo-zigbuild 在 amd64 runner 上交叉编译 amd64 和 arm64 服务端, 避免在 QEMU 中编译 Rust. 首次发布后, 仓库管理员需要在 GitHub Packages 的 package settings 中将该镜像设为 `Public`, 否则服务器需要先登录 GHCR.

在服务器新建部署目录并放入 `compose.yml`, 然后直接启动. Compose 会创建本地的 `data` 和 `secrets` 目录, 服务端会在首次启动时生成访问令牌.

```shell
docker compose up -d
docker compose exec sync-server cat /secrets/pinote-token
```

默认对外端口是 `8787`, 数据和令牌分别位于 `./data` 和 `./secrets/pinote-token`. 容器启动时会自动修正这两个挂载目录的权限, 随后以 UID `10001` 运行同步服务. 已有令牌不会被覆盖.

原有 Docker secret 部署仍然可用. 将 secret 挂载到 `/run/secrets/pinote_token`, 并通过 `--token-file /run/secrets/pinote_token` 或 `PINOTE_TOKEN_FILE` 指定路径即可. 服务端会直接读取已有 secret, 不会覆盖其内容.

如果需要改变端口, 数据路径, 令牌目录或镜像版本, 可在 Compose 项目目录中设置 `PINOTE_PORT`, `PINOTE_DATA_PATH`, `PINOTE_SECRETS_PATH` 或 `PINOTE_IMAGE_TAG`. 例如将 `PINOTE_IMAGE_TAG` 设为 `1.2.0` 可以固定部署版本, 避免跟随 `latest`.

检查容器状态, 日志和就绪探针.

```shell
docker compose ps
docker compose logs --tail=100 sync-server
curl --fail --show-error http://127.0.0.1:8787/readyz
```

如果设置了其他 `PINOTE_PORT`, `curl` 和桌面客户端地址也需要使用新的宿主机端口. 远程客户端不能填写 `127.0.0.1`, 应填写服务器局域网地址或 HTTPS 域名.

### 迁移与备份

迁移前先停止服务, 避免在 SQLite WAL 写入期间复制文件. 数据归档包含访问令牌, 应通过加密通道传输并限制读取权限.

```shell
docker compose down
sudo tar -czf pinote-sync-data.tar.gz compose.yml data secrets
sudo chown "$(id -u):$(id -g)" pinote-sync-data.tar.gz
chmod 600 pinote-sync-data.tar.gz
```

在目标服务器解压数据后直接启动. 新服务器会自动从 GHCR 拉取镜像.

```shell
sudo tar -xzf pinote-sync-data.tar.gz
sudo chown "$(id -u):$(id -g)" compose.yml
docker compose up -d
```

容器会在启动时修正恢复目录的权限. 确认新服务器就绪后再删除旧服务器的数据. `docker compose down` 不会删除 `./data` 或 `./secrets`, 只有手动删除部署目录才会删除同步数据库和访问令牌.

### 更新与令牌轮换

使用 `latest` 时, 拉取 GHCR 中的新镜像并重建容器.

```shell
docker compose pull
docker compose up -d
```

删除旧令牌并重启服务即可生成新令牌, 随后需要在每台桌面客户端中填写新令牌.

```shell
docker compose exec sync-server rm /secrets/pinote-token
docker compose restart sync-server
docker compose exec sync-server cat /secrets/pinote-token
```

令牌文件只能包含令牌本身, 不要写成 `KEY=value`. 不要提交本地环境变量文件, `data` 或 `secrets` 目录. 公网部署必须在服务前配置 HTTPS 反向代理和防火墙, 不应直接暴露明文 HTTP.

### 本地容器构建

需要从当前源码构建镜像时, 将 `compose.local.yml` 作为覆盖文件加载. 该文件会将 GHCR 镜像替换为本地构建的 `pinote-sync-server:local`.

```shell
docker compose -f compose.yml -f compose.local.yml up -d --build
```

### 从源码直接运行

不使用容器时可以通过 `just` 启动服务.

```shell
just sync-server --host 0.0.0.0 --port 8787 --data-dir ./data
```

服务会自动创建 `./data` 并将首次生成的令牌写入 `./data/pinote-token`. 如需使用已有令牌文件, 可额外传入 `--token-file`. 从便签三点菜单或主窗口打开云同步, 填写服务地址和相同令牌即可连接.
