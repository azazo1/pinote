import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { shellSingleQuote } from "./escaping.mjs";
import { buildMacApplyScript } from "./install-macos.mjs";
import { buildWindowsApplyScript } from "./install-windows.mjs";
import {
  applyPaths,
  assertSafeApplyPaths,
  isDirectoryWritable,
  moveDirectory,
  resolveAppLayout,
  resolveInstallPlan,
  swapApplicationDirectory,
} from "./install.mjs";

describe("shellSingleQuote", () => {
  it("转义单引号, 避免注入破坏脚本", () => {
    expect(shellSingleQuote("/Applications/Pinote.app")).toBe("'/Applications/Pinote.app'");
    expect(shellSingleQuote("/tmp/it's here")).toBe("'/tmp/it'\\''s here'");
  });
});

describe("resolveAppLayout", () => {
  it("识别 macOS .app 包", () => {
    expect(resolveAppLayout({ execPath: "/Applications/Pinote.app/Contents/MacOS/Pinote", platform: "darwin" }))
      .toMatchObject({
        kind: "macos-bundle",
        bundlePath: "/Applications/Pinote.app",
        appDir: "/Applications",
        targetPath: "/Applications/Pinote.app",
      });
  });

  it("识别便携运行与 AppImage", () => {
    expect(resolveAppLayout({ execPath: "/opt/pinote/pinote", platform: "darwin" })).toMatchObject({ kind: "portable" });
    expect(resolveAppLayout({
      execPath: "/tmp/.mount_pinote/pinote",
      platform: "linux",
      env: { APPIMAGE: "/home/u/Pinote.AppImage" },
    })).toMatchObject({ kind: "appimage", appImagePath: "/home/u/Pinote.AppImage" });
    expect(resolveAppLayout({ execPath: "/home/u/pinote/pinote", platform: "linux", env: {} }))
      .toMatchObject({ kind: "portable-directory", appDir: "/home/u/pinote", targetPath: "/home/u/pinote" });
  });
});

describe("applyPaths", () => {
  let userDataPath: string;

  beforeEach(() => {
    userDataPath = mkdtempSync(path.join(tmpdir(), "pinote-apply-paths-"));
  });

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true });
  });

  it("macOS 的暂存与备份落在应用包同级, 不退到根目录", () => {
    const paths = applyPaths({ userDataPath, targetPath: "/Applications/Pinote.app", version: "v0.6.0" });

    expect(paths.staging).toBe("/Applications/.Pinote.app.update-0.6.0");
    expect(paths.backup).toBe("/Applications/Pinote.app.old");
  });

  it("linux 沿用应用目录同级的路径", () => {
    expect(applyPaths({ userDataPath, targetPath: "/opt/pinote", version: "v0.6.0" }))
      .toMatchObject({ staging: "/opt/.pinote.update-0.6.0", backup: "/opt/pinote.old" });
  });
});

describe("assertSafeApplyPaths", () => {
  it("接受与替换目标同级的暂存与备份", () => {
    expect(assertSafeApplyPaths({
      targetPath: "/Applications/Pinote.app",
      stagingPath: "/Applications/.Pinote.app.update-0.6.0",
      backupPath: "/Applications/Pinote.app.old",
    })).toBe(true);
  });

  it("拒绝退到父目录的备份, 避免整目录被改名删除", () => {
    expect(() => assertSafeApplyPaths({
      targetPath: "/Applications/Pinote.app",
      stagingPath: "/.Applications.update-0.6.0",
      backupPath: "/Applications.old",
    })).toThrow(/替换路径不安全/);
  });
});

describe("resolveInstallPlan", () => {
  it("macOS 只在 .app 内运行时交接替换脚本", () => {
    expect(resolveInstallPlan({
      platform: "darwin",
      layout: { kind: "macos-bundle", appDir: "/Applications", bundlePath: "/Applications/Pinote.app" },
      directoryWritable: true,
    })).toMatchObject({ strategy: "macos-handoff" });
    expect(resolveInstallPlan({
      platform: "darwin",
      layout: { kind: "portable", appDir: "/tmp" },
      directoryWritable: true,
    }).strategy).toBe("manual");
  });

  it("linux 与 windows 在可写目录内换位替换, AppImage 走手动安装", () => {
    expect(resolveInstallPlan({
      platform: "linux",
      layout: { kind: "portable-directory", appDir: "/opt/pinote", executable: "/opt/pinote/pinote" },
      directoryWritable: true,
    }).strategy).toBe("linux-swap");
    expect(resolveInstallPlan({
      platform: "win32",
      layout: { kind: "portable-directory", appDir: "C:\\Pinote", executable: "C:\\Pinote\\Pinote.exe" },
      directoryWritable: true,
    }).strategy).toBe("windows-handoff");
    expect(resolveInstallPlan({
      platform: "linux",
      layout: { kind: "appimage", appDir: "/home/u" },
      directoryWritable: true,
    }).strategy).toBe("manual");
    expect(resolveInstallPlan({
      platform: "linux",
      layout: { kind: "portable-directory", appDir: "/usr/lib/pinote" },
      directoryWritable: false,
    }).strategy).toBe("manual");
  });
});

describe("isDirectoryWritable", () => {
  it("把权限探测的异常转成布尔值", () => {
    expect(isDirectoryWritable("/writable", () => {})).toBe(true);
    expect(isDirectoryWritable("/readonly", () => { throw new Error("EACCES"); })).toBe(false);
  });
});

describe("替换脚本内容", () => {
  it("macOS 脚本等旧进程退出, 失败时回滚并重新拉起", () => {
    const script = buildMacApplyScript({
      pid: 42,
      bundlePath: "/Applications/Pinote.app",
      dmgPath: "/data/update/pinote-0.6.0-macos-aarch64.dmg",
      stagingPath: "/Applications/.Pinote.app.update-0.6.0",
      backupPath: "/Applications/Pinote.app.old",
      mountPath: "/data/update/mount-1",
      logPath: "/data/update/apply-update.log",
      resultPath: "/data/update/apply-update-result.txt",
    });
    expect(script).toContain("trap '' HUP");
    expect(script).toContain("PID='42'");
    expect(script).toContain('while kill -0 "$PID"');
    expect(script).toContain("DMG='/data/update/pinote-0.6.0-macos-aarch64.dmg'");
    expect(script).toContain('hdiutil attach "$DMG"');
    expect(script).toContain("xattr -dr com.apple.quarantine");
    expect(script).toContain('mv "$BUNDLE" "$BACKUP"');
    expect(script).toContain('open "$BUNDLE"');
  });

  it("macOS 脚本把外部命令的报错写进替换日志", () => {
    const script = buildMacApplyScript({
      pid: 42,
      bundlePath: "/Applications/Pinote.app",
      dmgPath: "/data/update/pinote-0.6.0-macos-aarch64.dmg",
      stagingPath: "/Applications/.Pinote.app.update-0.6.0",
      backupPath: "/Applications/Pinote.app.old",
      mountPath: "/data/update/mount-1",
      logPath: "/data/update/apply-update.log",
      resultPath: "/data/update/apply-update-result.txt",
    });

    expect(script).toContain('ditto "$SOURCE_APP" "$STAGING" >> "$LOG" 2>&1');
    expect(script).toContain('hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MOUNT" >> "$LOG" 2>&1');
    expect(script).toContain('"$BUNDLE_DIR"/.*)');
    expect(script).toContain('"$BUNDLE".old)');
    expect(script).toContain('MOVED=0');
  });

  it("windows 脚本等待旧进程, 目标不可写时给出可读原因", () => {
    const script = buildWindowsApplyScript({
      pid: 7,
      appDir: "C:\\Users\\u\\AppData\\Local\\Programs\\Pinote",
      exeName: "Pinote.exe",
      stagingPath: "C:\\Users\\u\\AppData\\Local\\Programs\\.Pinote.update-0.6.0",
      backupPath: "C:\\Users\\u\\AppData\\Local\\Programs\\Pinote.old",
      logPath: "C:\\Users\\u\\AppData\\Roaming\\Pinote\\update\\apply-update.log",
      resultPath: "C:\\Users\\u\\AppData\\Roaming\\Pinote\\update\\apply-update-result.txt",
    });
    expect(script).toContain("$TargetPid = 7");
    expect(script).toContain("Get-Process -Id $TargetPid");
    expect(script).toContain("目标目录不可写");
    expect(script).toContain("Move-Item -LiteralPath $AppDir -Destination $Backup -Force");
    expect(script).toContain("Move-Item -LiteralPath $Staging -Destination $AppDir -Force");
    expect(script).toContain("$AppDir = 'C:\\Users\\u\\AppData\\Local\\Programs\\Pinote'");
  });
});

describe("swapApplicationDirectory", () => {
  it("暂存目录就位失败时回滚, 应用目录保持可用", async () => {
    const renames = [];
    await expect(swapApplicationDirectory({
      appDir: "/opt/pinote",
      stagingDir: "/opt/.pinote.update-0.6.0",
      remove: async () => {},
      rename: async (from, to) => {
        renames.push([from, to]);
        if (from === "/opt/.pinote.update-0.6.0") throw new Error("EXDEV");
      },
    })).rejects.toThrow("已回滚");
    expect(renames).toEqual([
      ["/opt/pinote", "/opt/pinote.old"],
      ["/opt/.pinote.update-0.6.0", "/opt/pinote"],
      ["/opt/pinote.old", "/opt/pinote"],
    ]);
  });

  it("替换成功后设置可执行权限并清理备份", async () => {
    const steps = [];
    await swapApplicationDirectory({
      appDir: "/opt/pinote",
      stagingDir: "/opt/.pinote.update-0.6.0",
      executableName: "pinote",
      platform: "linux",
      remove: async (target) => steps.push(["remove", target]),
      rename: async (from, to) => steps.push(["rename", from, to]),
      chmod: (target, mode) => steps.push(["chmod", target, mode.toString(8)]),
    });
    expect(steps).toEqual([
      ["remove", "/opt/pinote.old"],
      ["rename", "/opt/pinote", "/opt/pinote.old"],
      ["rename", "/opt/.pinote.update-0.6.0", "/opt/pinote"],
      ["chmod", "/opt/pinote/pinote", "755"],
      ["remove", "/opt/pinote.old"],
    ]);
  });
});

describe("moveDirectory", () => {
  it("跨文件系统时退回复制后删除源目录", async () => {
    const steps = [];
    const method = await moveDirectory({
      from: "/opt/.pinote.update-0.6.0",
      to: "/opt/pinote",
      rename: async () => { throw Object.assign(new Error("EXDEV"), { code: "EXDEV" }); },
      copy: async (from, to) => steps.push(["copy", from, to]),
      remove: async (target) => steps.push(["remove", target]),
    });
    expect(method).toBe("copy");
    expect(steps[0]).toEqual(["copy", "/opt/.pinote.update-0.6.0", "/opt/pinote"]);
  });
});
