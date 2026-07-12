import { describe, expect, it, vi } from "vitest";
import { RendererFlushCoordinator } from "./renderer-flush.mjs";

describe("RendererFlushCoordinator", () => {
  it("succeeds immediately without renderer targets", async () => {
    const coordinator = new RendererFlushCoordinator();

    await expect(coordinator.request([], () => {})).resolves.toBe(true);
  });

  it("waits for every renderer acknowledgement", async () => {
    const coordinator = new RendererFlushCoordinator();
    const sent: Array<{ targetId: number; requestId: string }> = [];
    let completed = false;
    const request = coordinator.request([11, 22], (targetId, requestId) => {
      sent.push({ targetId, requestId });
    });
    void request.then(() => {
      completed = true;
    });

    expect(sent).toHaveLength(2);
    coordinator.complete(sent[0].requestId, 11);
    await Promise.resolve();
    expect(completed).toBe(false);
    coordinator.complete(sent[0].requestId, 22);
    await expect(request).resolves.toBe(true);
    expect(completed).toBe(true);
  });

  it("finishes after the timeout when a renderer does not reply", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const coordinator = new RendererFlushCoordinator(50, onTimeout);
    const request = coordinator.request([11], () => {});

    await vi.advanceTimersByTimeAsync(50);
    await expect(request).resolves.toBe(false);

    expect(onTimeout).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });

  it("reports a renderer save failure", async () => {
    const coordinator = new RendererFlushCoordinator();
    let requestId = "";
    const request = coordinator.request([11], (_targetId, value) => {
      requestId = value;
    });

    coordinator.complete(requestId, 11, false);

    await expect(request).resolves.toBe(false);
  });
});
