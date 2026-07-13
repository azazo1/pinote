import { describe, expect, it, vi } from "vitest";
import { SseChangeStream, SseDecoder } from "./sse-change-stream.mjs";

describe("SseDecoder", () => {
  it("decodes changed events across chunk boundaries", () => {
    const decoder = new SseDecoder();

    expect(decoder.push("event: ready\n\nevent: chan")).toEqual([
      { type: "ready", data: "" },
    ]);
    expect(decoder.push("ged\ndata: 42\n\n")).toEqual([
      { type: "changed", data: "42" },
    ]);
  });

  it("supports CRLF, comments, and multiline data", () => {
    const decoder = new SseDecoder();

    expect(decoder.push(": keepalive\r\nevent: changed\r\ndata: 4\r\ndata: 5\r\n\r\n")).toEqual([
      { type: "changed", data: "4\n5" },
    ]);
  });

  it("authenticates the stream and forwards changed events", async () => {
    const encoder = new TextEncoder();
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("event: ready\n\nevent: changed\ndata: 7\n\n"));
        controller.close();
      },
    })));
    const logger = { info: vi.fn(), warn: vi.fn() };
    let notify = (_revision: string) => {};
    const changed = new Promise<string>((resolve) => {
      notify = resolve;
    });
    const stream = new SseChangeStream((revision) => notify(revision), { fetchImpl, logger });

    stream.start("https://notes.example.com", "secret-token");

    await expect(changed).resolves.toBe("7");
    expect(fetchImpl).toHaveBeenCalledWith("https://notes.example.com/v1/events", {
      headers: {
        accept: "text/event-stream",
        authorization: "Bearer secret-token",
      },
      signal: expect.any(AbortSignal),
    });
    await stream.stop();
  });
});
