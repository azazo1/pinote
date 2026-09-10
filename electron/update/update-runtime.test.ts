import { describe, expect, it } from "vitest";
import { createUpdateSnapshot, reduceUpdate } from "./update-runtime.mjs";

function snapshot() {
  return createUpdateSnapshot({ currentVersion: "v0.5.0", autoCheck: true, skippedVersion: "" });
}

const release = {
  tagName: "v0.6.0",
  name: "Pinote v0.6.0",
  notes: "更新内容",
  htmlUrl: "https://example.com/releases/tag/v0.6.0",
};

describe("reduceUpdate", () => {
  it("检查到新版本进入 available", () => {
    const state = reduceUpdate(snapshot(), {
      type: "check-result",
      release,
      asset: { name: "pinote-0.6.0-macos-aarch64.dmg" },
      updateAvailable: true,
      manual: true,
      skipped: false,
    });
    expect(state).toMatchObject({
      state: "available",
      latestVersion: "v0.6.0",
      assetName: "pinote-0.6.0-macos-aarch64.dmg",
      releaseNotes: "更新内容",
      skipped: false,
    });
  });

  it("没有新版本进入 up-to-date", () => {
    expect(reduceUpdate(snapshot(), {
      type: "check-result",
      release,
      asset: null,
      updateAvailable: false,
      manual: false,
      skipped: false,
    }).state).toBe("up-to-date");
  });

  it("下载进度只在 downloading 状态更新", () => {
    const checking = reduceUpdate(snapshot(), { type: "check-start", manual: false });
    expect(reduceUpdate(checking, { type: "download-progress", received: 1, total: 2 }).progress).toBeNull();

    const downloading = reduceUpdate(snapshot(), { type: "download-start", total: 2_000 });
    expect(reduceUpdate(downloading, { type: "download-progress", received: 1_000, total: 2_000 }).progress)
      .toEqual({ received: 1_000, total: 2_000 });
  });

  it("取消下载回到 available 并清掉进度", () => {
    const downloading = reduceUpdate(snapshot(), { type: "download-start", total: 2_000 });
    expect(reduceUpdate(downloading, { type: "download-cancelled" })).toMatchObject({
      state: "available",
      progress: null,
    });
  });

  it("安装结果区分为已就绪, 已交接与手动安装", () => {
    const base = reduceUpdate(snapshot(), { type: "download-start", total: 10 });
    expect(reduceUpdate(base, { type: "install-finished", result: { state: "ready-to-restart" } }).state)
      .toBe("ready-to-restart");
    expect(reduceUpdate(base, { type: "install-finished", result: { state: "handed-off" } }).state)
      .toBe("handed-off");
    expect(reduceUpdate(base, { type: "install-finished", result: { state: "manual", message: "请手动安装" } }))
      .toMatchObject({ state: "manual-required", message: "请手动安装" });
  });

  it("跳过此版本后不再提示但保留信息", () => {
    const available = reduceUpdate(snapshot(), {
      type: "check-result",
      release,
      asset: null,
      updateAvailable: true,
      manual: false,
      skipped: false,
    });
    expect(reduceUpdate(available, { type: "skip-version", version: "0.6.0" })).toMatchObject({
      state: "up-to-date",
      skipped: true,
      skippedVersion: "0.6.0",
      latestVersion: "v0.6.0",
    });
  });

  it("静默检查失败保留 manualCheck 标记", () => {
    expect(reduceUpdate(snapshot(), {
      type: "check-failed",
      manual: false,
      error: { message: "网络不可用", kind: "network" },
    })).toMatchObject({ state: "failed", manualCheck: false, error: { message: "网络不可用" } });
  });
});
