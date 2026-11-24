import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvoidanceService } from "./avoidance-service.mjs";

const area = { x: 0, y: 0, width: 1440, height: 900 };
const noteBounds = { x: 600, y: 380, width: 253, height: 220 };
const pointer = { x: 700, y: 500 };

interface FakeWindow {
  bounds: typeof noteBounds;
  ignoring: boolean;
  destroyed: boolean;
  webContents: { send: (channel: string, value: boolean) => void; isDestroyed: () => boolean };
  isDestroyed: () => boolean;
  isVisible: () => boolean;
  getBounds: () => typeof noteBounds;
  setBounds: (bounds: typeof noteBounds) => void;
  setIgnoreMouseEvents: (value: boolean) => void;
}

function createFakeWindow(bounds = noteBounds) {
  const received: boolean[] = [];
  const window: FakeWindow = {
    bounds: { ...bounds },
    ignoring: false,
    destroyed: false,
    webContents: {
      send: (_channel, value) => { received.push(value); },
      isDestroyed: () => false,
    },
    isDestroyed: () => window.destroyed,
    isVisible: () => true,
    getBounds: () => ({ ...window.bounds }),
    setBounds: (next) => { window.bounds = { ...next }; },
    setIgnoreMouseEvents: (value) => { window.ignoring = value; },
  };
  return { window, received };
}

let clock = 0;

function createService(targets: Array<{ key: string; window: FakeWindow }>) {
  return new AvoidanceService({
    getTargets: () => targets,
    workAreaFor: () => area,
    now: () => clock,
    logger: { info() {}, warn() {} },
  });
}

function advance(ms: number) {
  const step = 16;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    clock += step;
    vi.advanceTimersByTime(step);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AvoidanceService", () => {
  it("only takes notes near the pointer", () => {
    const near = createFakeWindow();
    const far = createFakeWindow({ x: 100, y: 100, width: 253, height: 220 });
    const service = createService([{ key: "near", window: near.window }, { key: "far", window: far.window }]);

    expect(service.begin(pointer)).toBe(true);
    expect(service.isTracking(near.window)).toBe(true);
    expect(service.isTracking(far.window)).toBe(false);
    expect(near.window.ignoring).toBe(false);
    expect(far.window.ignoring).toBe(false);
  });

  it("does nothing when the pointer is far from every note", () => {
    const note = createFakeWindow();
    const service = createService([{ key: "note", window: note.window }]);

    expect(service.begin({ x: 100, y: 50 })).toBe(false);
    expect(service.isActive()).toBe(false);
  });

  it("floats the note outside the work area and returns it to the exact original position", () => {
    const note = createFakeWindow();
    const service = createService([{ key: "note", window: note.window }]);
    const origin = note.window.getBounds();

    service.begin(pointer);
    advance(2_000);
    expect(note.window.bounds.y).toBeGreaterThanOrEqual(area.y + area.height);
    expect(note.window.ignoring).toBe(true);
    expect(note.received).toContain(true);

    service.finish();
    advance(4_000);
    expect(note.window.getBounds()).toEqual(origin);
    expect(note.window.ignoring).toBe(false);
    expect(note.received.at(-1)).toBe(false);
    expect(service.isActive()).toBe(false);
  });

  it("keeps the original position when pressed again during the return animation", () => {
    const note = createFakeWindow();
    const service = createService([{ key: "note", window: note.window }]);
    const origin = note.window.getBounds();

    service.begin(pointer);
    advance(2_000);
    service.finish();
    advance(60);

    service.begin(pointer);
    advance(2_000);
    service.finish();
    advance(4_000);

    expect(note.window.getBounds()).toEqual(origin);
    expect(note.window.ignoring).toBe(false);
  });

  it("returns notes that were still waiting for their turn", () => {
    const first = createFakeWindow();
    const second = createFakeWindow({ x: 690, y: 420, width: 253, height: 220 });
    const service = createService([{ key: "first", window: first.window }, { key: "second", window: second.window }]);
    const firstOrigin = first.window.getBounds();
    const secondOrigin = second.window.getBounds();

    service.begin(pointer);
    service.finish();
    advance(4_000);

    expect(first.window.getBounds()).toEqual(firstOrigin);
    expect(second.window.getBounds()).toEqual(secondOrigin);
  });

  it("stops tracking a window that was closed during the animation", () => {
    const note = createFakeWindow();
    const service = createService([{ key: "note", window: note.window }]);

    service.begin(pointer);
    advance(200);
    note.window.destroyed = true;
    service.forget(note.window);
    advance(400);

    expect(service.isActive()).toBe(false);
  });

  it("restores positions immediately when disposed", () => {
    const note = createFakeWindow();
    const service = createService([{ key: "note", window: note.window }]);
    const origin = note.window.getBounds();

    service.begin(pointer);
    advance(200);
    service.dispose();

    expect(note.window.getBounds()).toEqual(origin);
    expect(note.window.ignoring).toBe(false);
    expect(service.isActive()).toBe(false);
  });
});
