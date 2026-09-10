import { describe, expect, it } from "vitest";
import { compareVersions, isFakeBuildVersion, isNewerVersion, normalizeVersion, resolveRuntimeVersion } from "./version.mjs";

describe("normalizeVersion", () => {
  it("去除前导 v 与构建 commit 后缀", () => {
    expect(normalizeVersion("v0.5.0")).toBe("0.5.0");
    expect(normalizeVersion("0.5.0-a1b2c3d")).toBe("0.5.0");
    expect(normalizeVersion("v0.5.0^a1b2c3d")).toBe("0.5.0");
    expect(normalizeVersion("dev-build")).toBe("dev-build");
  });
});

describe("isNewerVersion", () => {
  it("严格大于当前版本才提示更新", () => {
    expect(isNewerVersion("v0.5.1", "v0.5.0")).toBe(true);
    expect(isNewerVersion("v0.5.0", "v0.5.0")).toBe(false);
    expect(isNewerVersion("v0.4.9", "v0.5.0")).toBe(false);
    expect(isNewerVersion("v0.6.0", "v0.5.0-a1b2c3d")).toBe(true);
  });

  it("dev-build 与不可解析版本永远不提示更新", () => {
    expect(isNewerVersion("v0.5.1", "dev-build")).toBe(false);
    expect(isNewerVersion("nightly", "v0.5.0")).toBe(false);
  });

  it("预发布版本低于同号正式版本", () => {
    expect(compareVersions("v0.6.0-rc.1", "v0.6.0")).toBe(-1);
    expect(compareVersions("v0.6.0", "v0.6.0-rc.1")).toBe(1);
  });
});

describe("resolveRuntimeVersion", () => {
  it("优先使用环境变量覆盖", () => {
    expect(resolveRuntimeVersion({
      env: { PINOTE_BUILD_VERSION: "v9.9.9" },
      packaged: true,
      resourcesPath: "/app/resources",
      readFile: () => JSON.stringify({ version: "v0.5.0" }),
    })).toBe("v9.9.9");
  });

  it("打包产物读取 resources/build-version.json", () => {
    expect(resolveRuntimeVersion({
      env: {},
      packaged: true,
      resourcesPath: "/app/resources",
      readFile: () => JSON.stringify({ version: "v0.5.0-a1b2c3d" }),
    })).toBe("v0.5.0-a1b2c3d");
  });

  it("开发构建显示 dev-build", () => {
    expect(resolveRuntimeVersion({ env: {}, packaged: false, resourcesPath: null })).toBe("dev-build");
  });

  it("打包产物缺少版本文件时退回包版本", () => {
    expect(resolveRuntimeVersion({
      env: {},
      packaged: true,
      resourcesPath: "/app/resources",
      appVersion: "0.5.0",
      readFile: () => { throw new Error("ENOENT"); },
    })).toBe("v0.5.0");
  });
});

describe("isFakeBuildVersion", () => {
  it("识别 fake 构建版本", () => {
    expect(isFakeBuildVersion("v0.0.0")).toBe(true);
    expect(isFakeBuildVersion("0.0.0")).toBe(true);
    expect(isFakeBuildVersion("v0.5.0")).toBe(false);
    expect(isFakeBuildVersion("dev-build")).toBe(false);
  });
});
