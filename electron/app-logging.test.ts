import { describe, expect, it } from "vitest";
import { archivePath, dateStamp, parseLogLevel, pruneArchivedLogs, resolveLogFile } from "./app-logging.mjs";

describe("parseLogLevel", () => {
  it("接受 electron-log 支持的级别", () => {
    expect(parseLogLevel("debug")).toBe("debug");
    expect(parseLogLevel("INFO")).toBe("info");
    expect(parseLogLevel("silly")).toBe("silly");
  });

  it("把 just debug 注入的 trace 映射到最详细档", () => {
    expect(parseLogLevel("trace")).toBe("silly");
  });

  it("未知取值回退到默认等级", () => {
    expect(parseLogLevel("chatty")).toBe("info");
    expect(parseLogLevel(undefined)).toBe("info");
    expect(parseLogLevel("", "warn")).toBe("warn");
  });
});

describe("resolveLogFile", () => {
  it("环境变量覆盖优先于数据目录默认值", () => {
    expect(resolveLogFile({ env: { PINOTE_LOG_FILE: "/tmp/pinote-debug/app.log" }, userDataPath: "/data" }))
      .toBe("/tmp/pinote-debug/app.log");
    expect(resolveLogFile({ env: {}, userDataPath: "/data" })).toBe("/data/logs/pinote.log");
  });
});

describe("dateStamp", () => {
  it("按本地日期生成 8 位标记", () => {
    expect(dateStamp(new Date(2026, 8, 10))).toBe("20260910");
  });
});

describe("archivePath", () => {
  it("同日多次归档时追加序号, 不覆盖已有归档", () => {
    const date = new Date(2026, 8, 10);
    const existing = new Set(["/data/logs/pinote.20260910.log"]);
    expect(archivePath("/data/logs/pinote.log", date, { exists: (file) => existing.has(file) }))
      .toBe("/data/logs/pinote.20260910-1.log");
  });
});

describe("pruneArchivedLogs", () => {
  it("只保留最近 keep 个归档", () => {
    const removed = [];
    const archived = {
      "pinote.20260908.log": 1,
      "pinote.20260909.log": 2,
      "pinote.20260910.log": 3,
    };
    const result = pruneArchivedLogs({
      logFile: "/data/logs/pinote.log",
      keep: 2,
      list: () => [...Object.keys(archived), "pinote.log"],
      stat: (file) => ({ mtimeMs: archived[file.replace("/data/logs/", "")] ?? 0 }),
      remove: (file) => removed.push(file),
    });
    expect(removed).toEqual(["/data/logs/pinote.20260908.log"]);
    expect(result).toEqual(["/data/logs/pinote.20260908.log"]);
  });
});
