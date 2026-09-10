import type { UpdateSnapshot } from "../types";

export function formatBytes(bytes: number | null | undefined): string {
  if (!Number.isFinite(bytes ?? NaN) || (bytes ?? 0) < 0) return "";
  const value = bytes as number;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function progressPercent(state: UpdateSnapshot): number | null {
  const progress = state.progress;
  if (!progress || !Number.isFinite(progress.total) || (progress.total ?? 0) <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((progress.received / (progress.total as number)) * 100)));
}

export function displayVersion(version: string | null | undefined): string {
  if (!version) return "";
  return version.startsWith("v") ? version : `v${version}`;
}

export function isHandoffState(state: UpdateSnapshot): boolean {
  return state.state === "handed-off";
}

// 更新窗口正文: 一行状态结论.
export function statusHeadline(state: UpdateSnapshot): string {
  switch (state.state) {
    case "checking":
      return "正在检查更新";
    case "up-to-date":
      return state.checkedAt ? "已经是最新版本" : "尚未检查更新";
    case "available":
      return `发现新版本 ${displayVersion(state.latestVersion)}`;
    case "downloading":
      return `正在下载 ${displayVersion(state.latestVersion)}`;
    case "ready-to-restart":
      return "新版本已就绪, 重启后生效";
    case "handed-off":
      return "正在退出并替换, 请勿手动关闭进程";
    case "manual-required":
      return "安装包已下载, 需要手动完成安装";
    case "failed":
      return state.manualCheck ? "检查更新失败" : "暂时无法获取更新信息";
    default:
      return "自动更新已就绪";
  }
}

// 更新窗口正文: 状态补充说明.
export function statusDetail(state: UpdateSnapshot): string {
  switch (state.state) {
    case "idle":
      return "启动后会自动检查一次新版本, 也可以随时手动检查.";
    case "up-to-date":
      return state.isFakeBuild ? "当前是测试构建, 任何正式版本都会被视为更新." : "不需要做任何操作.";
    case "available":
      return state.skipped ? "这个版本已被跳过, 自动检查不会再提示." : "下载完成后可以立即替换并重启.";
    case "downloading": {
      const progress = state.progress;
      if (!progress) return "正在准备下载.";
      const total = formatBytes(progress.total);
      return total
        ? `已下载 ${formatBytes(progress.received)} / ${total}`
        : `已下载 ${formatBytes(progress.received)}`;
    }
    case "ready-to-restart":
      return "重新启动应用即可使用新版本, 便签内容不会丢失.";
    case "handed-off":
      return "替换完成后应用会自动重新启动.";
    case "manual-required":
      return state.message || "当前运行方式无法自动替换, 请按提示手动安装.";
    case "failed":
      return state.error?.message ?? "请稍后重试.";
    default:
      return "";
  }
}

// 主窗口状态栏: 无更新时显示版本号, 有更新时显示引导链接.
export function statusBarLabel(state: UpdateSnapshot): { text: string; link: boolean } {
  const percent = progressPercent(state);
  switch (state.state) {
    case "available":
      if (state.skipped) return { text: state.currentVersion, link: false };
      return { text: `新版本 ${displayVersion(state.latestVersion)} 可用`, link: true };
    case "downloading":
      return { text: percent === null ? "正在下载更新" : `正在下载更新 ${percent}%`, link: true };
    case "ready-to-restart":
      return { text: "新版本已就绪, 点击重启", link: true };
    case "handed-off":
      return { text: "正在替换新版本", link: true };
    case "manual-required":
      return { text: "新版本需要手动安装", link: true };
    default:
      return { text: state.currentVersion, link: false };
  }
}
