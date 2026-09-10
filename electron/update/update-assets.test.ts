import { describe, expect, it } from "vitest";
import { assetNameCandidates, archKey, platformKey, platformSupport, selectAsset } from "./assets.mjs";
import { parseChecksums, pickDigest, resumeDecision } from "./download.mjs";

describe("平台与架构映射", () => {
  it("映射 electron 的 platform 与 arch", () => {
    expect(platformKey("darwin")).toBe("macos");
    expect(platformKey("win32")).toBe("windows");
    expect(platformKey("linux")).toBe("linux");
    expect(archKey("x64")).toBe("x86_64");
    expect(archKey("arm64")).toBe("aarch64");
  });

  it("未知平台或架构没有更新包", () => {
    expect(platformSupport("freebsd", "x64")).toBeNull();
    expect(platformSupport("linux", "ia32")).toBeNull();
    expect(platformSupport("linux", "x64")).toEqual({ platform: "linux", arch: "x86_64", extension: "tar.gz" });
  });
});

describe("assetNameCandidates", () => {
  it("标准命名优先, 兼容带 v 前缀的发布习惯", () => {
    const candidates = assetNameCandidates({
      version: "v0.6.0",
      platform: "macos",
      arch: "aarch64",
      extension: "dmg",
    });
    expect(candidates).toEqual(["pinote-0.6.0-macos-aarch64.dmg", "pinote-v0.6.0-macos-aarch64.dmg"]);
  });

  it("构建版本带 commit 后缀时归一化后匹配", () => {
    expect(assetNameCandidates({
      version: "v0.6.0-a1b2c3d",
      platform: "linux",
      arch: "x86_64",
      extension: "tar.gz",
    })[0]).toBe("pinote-0.6.0-linux-x86_64.tar.gz");
  });
});

describe("selectAsset", () => {
  it("按候选顺序挑出资产", () => {
    const assets = [{ name: "pinote-v0.6.0-linux-x86_64.tar.gz", url: "u" }];
    expect(selectAsset(assets, assetNameCandidates({
      version: "0.6.0",
      platform: "linux",
      arch: "x86_64",
      extension: "tar.gz",
    }))).toMatchObject({ url: "u" });
    expect(selectAsset(assets, ["pinote-0.6.0-linux-aarch64.tar.gz"])).toBeNull();
  });
});

describe("parseChecksums", () => {
  it("容忍二进制标记与 CRLF 行尾", () => {
    const checksums = parseChecksums("abc\n");
    expect(checksums.size).toBe(0);
    const parsed = parseChecksums([
      `${"a".repeat(64)}  pinote-0.6.0-linux-x86_64.tar.gz`,
      `${"B".repeat(64)} *pinote-0.6.0-windows-x86_64.zip`,
    ].join("\r\n"));
    expect(parsed.get("pinote-0.6.0-linux-x86_64.tar.gz")).toBe("a".repeat(64));
    expect(parsed.get("pinote-0.6.0-windows-x86_64.zip")).toBe("b".repeat(64));
  });

  it("摘要大小写不敏感比对", () => {
    const parsed = parseChecksums(`${"AB".repeat(32)}  archive.zip`);
    expect(pickDigest(parsed, ["archive.zip"])).toBe("ab".repeat(32));
    expect(pickDigest(parsed, ["other.zip"])).toBeNull();
  });
});

describe("resumeDecision", () => {
  it("按 .part 与总大小决定续传, 校验还是重下", () => {
    expect(resumeDecision({ partSize: 0, total: 100 })).toBe("restart");
    expect(resumeDecision({ partSize: 40, total: 100 })).toBe("resume");
    expect(resumeDecision({ partSize: 40, total: null })).toBe("resume");
    expect(resumeDecision({ partSize: 100, total: 100 })).toBe("verify");
    expect(resumeDecision({ partSize: 120, total: 100 })).toBe("verify");
  });
});
