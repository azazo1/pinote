import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyUpdate, cleanupUpdateArtifacts, readApplyResult, updateDirectory } from "./install.mjs";

let root;

function makePortableApp() {
  const appDir = path.join(root, "pinote");
  mkdirSync(path.join(appDir, "resources"), { recursive: true });
  writeFileSync(path.join(appDir, "pinote"), "#!/bin/sh\necho 0.5.0\n", { mode: 0o755 });
  writeFileSync(path.join(appDir, "resources", "app.asar"), "old");
  return appDir;
}

function makeArchive() {
  const payload = path.join(root, "payload");
  mkdirSync(path.join(payload, "resources"), { recursive: true });
  writeFileSync(path.join(payload, "pinote"), "#!/bin/sh\necho 0.6.0\n", { mode: 0o755 });
  writeFileSync(path.join(payload, "resources", "app.asar"), "new");
  const archive = path.join(root, "pinote-0.6.0-linux-x86_64.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", payload, "."]);
  return archive;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "pinote-install-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("applyUpdate", () => {
  it("linux: 解包后整目录换位替换, 并清理备份", async () => {
    const appDir = makePortableApp();
    const userData = path.join(root, "userdata");
    const result = await applyUpdate({
      platform: "linux",
      execPath: path.join(appDir, "pinote"),
      env: {},
      packaged: true,
      userDataPath: userData,
      archivePath: makeArchive(),
      version: "v0.6.0",
    });

    expect(result).toMatchObject({ state: "ready-to-restart", executable: path.join(appDir, "pinote") });
    expect(readFileSync(path.join(appDir, "resources", "app.asar"), "utf8")).toBe("new");
    expect(execFileSync(path.join(appDir, "pinote"), { encoding: "utf8" })).toContain("0.6.0");
    expect(() => readFileSync(`${appDir}.old`, "utf8")).toThrow();
  });

  it("开发构建不替换自身可执行文件, 只提示手动处理", async () => {
    const appDir = makePortableApp();
    const result = await applyUpdate({
      platform: "linux",
      execPath: path.join(appDir, "pinote"),
      packaged: false,
      userDataPath: path.join(root, "userdata"),
      archivePath: makeArchive(),
      version: "v0.6.0",
    });

    expect(result.state).toBe("manual");
    expect(readFileSync(path.join(appDir, "resources", "app.asar"), "utf8")).toBe("old");
  });

  it("AppImage 运行方式交给用户手动安装", async () => {
    const result = await applyUpdate({
      platform: "linux",
      execPath: "/tmp/.mount_pinote/pinote",
      env: { APPIMAGE: path.join(root, "Pinote-0.5.0-x86_64.AppImage") },
      packaged: true,
      userDataPath: path.join(root, "userdata"),
      archivePath: makeArchive(),
      version: "v0.6.0",
    });

    expect(result).toMatchObject({ state: "manual" });
    expect(result.message).toContain("AppImage");
  });
});

describe("readApplyResult", () => {
  it("读取上次替换失败原因后删除文件", () => {
    const userData = path.join(root, "userdata");
    mkdirSync(updateDirectory(userData), { recursive: true });
    writeFileSync(path.join(updateDirectory(userData), "apply-update-result.txt"), "目标目录不可写\n");

    expect(readApplyResult(userData)).toBe("目标目录不可写");
    expect(readApplyResult(userData)).toBeNull();
  });
});

describe("cleanupUpdateArtifacts", () => {
  it("清理上次遗留的备份与暂存目录, 保留下载文件", () => {
    const appDir = makePortableApp();
    const userData = path.join(root, "userdata");
    mkdirSync(`${appDir}.old`, { recursive: true });
    mkdirSync(path.join(root, ".pinote.update-0.6.0"), { recursive: true });
    mkdirSync(path.join(updateDirectory(userData), "mount-1"), { recursive: true });
    writeFileSync(path.join(updateDirectory(userData), "pinote-0.6.0-linux-x86_64.tar.gz"), "archive");
    writeFileSync(path.join(updateDirectory(userData), "apply-update.sh"), "#!/bin/sh\n");

    cleanupUpdateArtifacts({
      userDataPath: userData,
      execPath: path.join(appDir, "pinote"),
      platform: "linux",
      env: {},
    });

    expect(() => readFileSync(path.join(`${appDir}.old`, "pinote"), "utf8")).toThrow();
    expect(() => readFileSync(path.join(root, ".pinote.update-0.6.0", "pinote"), "utf8")).toThrow();
    expect(() => readFileSync(path.join(updateDirectory(userData), "apply-update.sh"), "utf8")).toThrow();
    expect(readFileSync(path.join(updateDirectory(userData), "pinote-0.6.0-linux-x86_64.tar.gz"), "utf8"))
      .toBe("archive");
  });
});
