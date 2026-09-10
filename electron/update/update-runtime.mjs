// 更新状态机: Idle -> Checking -> (UpToDate | Available | Failed),
// Available -> Downloading -> (ReadyToRestart | HandedOff | ManualRequired | Failed).
//
// 状态集中在这里, UI 只读取不可变快照渲染; 具体网络与文件操作在 update-service 中执行.

export const UPDATE_STATES = Object.freeze({
  idle: "idle",
  checking: "checking",
  upToDate: "up-to-date",
  available: "available",
  downloading: "downloading",
  readyToRestart: "ready-to-restart",
  handedOff: "handed-off",
  manualRequired: "manual-required",
  failed: "failed",
});

export function createUpdateSnapshot({
  currentVersion,
  autoCheck = true,
  skippedVersion = "",
  canAutoInstall = true,
  isFakeBuild = false,
} = {}) {
  return {
    state: UPDATE_STATES.idle,
    currentVersion: currentVersion ?? "",
    latestVersion: null,
    releaseName: "",
    releaseNotes: "",
    releaseUrl: "",
    checkedAt: null,
    manualCheck: false,
    skipped: false,
    error: null,
    progress: null,
    applyResult: null,
    message: "",
    assetName: null,
    autoCheck,
    skippedVersion,
    canAutoInstall: Boolean(canAutoInstall),
    isFakeBuild: Boolean(isFakeBuild),
  };
}

export function isUpdateBusy(snapshot) {
  return snapshot.state === UPDATE_STATES.checking || snapshot.state === UPDATE_STATES.downloading;
}

export function isUpdatePending(snapshot) {
  return snapshot.state === UPDATE_STATES.available
    || snapshot.state === UPDATE_STATES.readyToRestart
    || snapshot.state === UPDATE_STATES.handedOff
    || snapshot.state === UPDATE_STATES.manualRequired;
}

export function reduceUpdate(snapshot, action) {
  switch (action.type) {
    case "check-start":
      return { ...snapshot, state: UPDATE_STATES.checking, manualCheck: Boolean(action.manual), error: null, message: "" };
    case "check-result": {
      const base = {
        ...snapshot,
        checkedAt: Date.now(),
        manualCheck: Boolean(action.manual),
        error: null,
        progress: null,
        latestVersion: action.release?.tagName ?? null,
        releaseName: action.release?.name ?? "",
        releaseNotes: action.release?.notes ?? "",
        releaseUrl: action.release?.htmlUrl ?? "",
        assetName: action.asset?.name ?? null,
      };
      if (!action.updateAvailable) {
        return { ...base, state: UPDATE_STATES.upToDate, skipped: false, message: "" };
      }
      return { ...base, state: UPDATE_STATES.available, skipped: Boolean(action.skipped), message: "" };
    }
    case "check-failed":
      return {
        ...snapshot,
        state: UPDATE_STATES.failed,
        checkedAt: Date.now(),
        manualCheck: Boolean(action.manual),
        error: action.error ?? null,
        progress: null,
        message: "",
      };
    case "download-start":
      return {
        ...snapshot,
        state: UPDATE_STATES.downloading,
        error: null,
        message: "",
        progress: { received: 0, total: Number.isFinite(action.total) ? action.total : null },
      };
    case "download-progress":
      if (snapshot.state !== UPDATE_STATES.downloading) return snapshot;
      return {
        ...snapshot,
        progress: { received: action.received ?? 0, total: Number.isFinite(action.total) ? action.total : null },
      };
    case "download-cancelled":
      return { ...snapshot, state: UPDATE_STATES.available, progress: null, message: "" };
    case "download-failed":
      return { ...snapshot, state: UPDATE_STATES.failed, error: action.error ?? null, progress: null, message: "" };
    case "install-finished": {
      const state = action.result?.state === "handed-off"
        ? UPDATE_STATES.handedOff
        : action.result?.state === "ready-to-restart"
          ? UPDATE_STATES.readyToRestart
          : UPDATE_STATES.manualRequired;
      return { ...snapshot, state, progress: null, message: action.result?.message ?? "", error: null };
    }
    case "apply-result":
      return { ...snapshot, applyResult: action.message ?? null };
    case "install-failed":
      return { ...snapshot, state: UPDATE_STATES.failed, error: action.error ?? null, progress: null, message: "" };
    case "settings":
      return {
        ...snapshot,
        autoCheck: action.autoCheck ?? snapshot.autoCheck,
        skippedVersion: action.skippedVersion ?? snapshot.skippedVersion,
        isFakeBuild: action.isFakeBuild ?? snapshot.isFakeBuild,
      };
    case "skip-version":
      return {
        ...snapshot,
        state: UPDATE_STATES.upToDate,
        skipped: true,
        skippedVersion: action.version ?? "",
        message: "",
        error: null,
      };
    default:
      return snapshot;
  }
}
