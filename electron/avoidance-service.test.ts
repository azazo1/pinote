import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvoidanceService } from "./avoidance-service.mjs";
import { avoidanceField, rectIntersectsCircle } from "./windowing/avoidance.mjs";

const area = { x: 0, y: 0, width: 1440, height: 900 };
const noteBounds = { x: 600, y: 380, width: 253, height: 220 };

interface FakeWindow {
  bounds: typeof noteBounds;
  ignoring: boolean;
  destroyed: boolean;
  isDestroyed: () => boolean;
  isVisible: () => boolean;
  getBounds: () => typeof noteBounds;
  setBounds: (bounds: typeof noteBounds) => void;
  setIgnoreMouseEvents: (value: boolean) => void;
}

function createFakeWindow(bounds = noteBounds) {
  const window: FakeWindow = {
    bounds: { ...bounds },
    ignoring: false,
    destroyed: false,
    isDestroyed: () => window.destroyed,
    isVisible: () => true,
    getBounds: () => ({ ...window.bounds }),
    setBounds: (next) => { window.bounds = { ...next }; },
    setIgnoreMouseEvents: (value) => { window.ignoring = value; },
  };
  return window;
}

let clock = 0;
let cursor = { x: 0, y: 0 };
let focused: FakeWindow | null = null;

function createService(targets: FakeWindow[]) {
  return new AvoidanceService({
    // 与窗口管理器一致: 聚焦的窗口不参与避让.
    getTargets: () => targets
      .filter((window) => window !== focused)
      .map((window) => ({ key: String(targets.indexOf(window)), window })),
    getCursor: () => cursor,
    getFocusedWindow: () => focused,
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

function insideField(bounds: typeof noteBounds) {
  return rectIntersectsCircle(bounds, avoidanceField(cursor));
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  cursor = { x: 0, y: 0 };
  focused = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AvoidanceService", () => {
  it("pushes only the note under the field and leaves the others alone", () => {
    const under = createFakeWindow();
    const elsewhere = createFakeWindow({ x: 100, y: 100, width: 253, height: 220 });
    const service = createService([under, elsewhere]);
    cursor = { x: 700, y: 500 };

    expect(service.start()).toBe(true);
    advance(800);

    expect(insideField(under.getBounds())).toBe(false);
    expect(under.getBounds()).not.toEqual(noteBounds);
    expect(under.ignoring).toBe(true);
    expect(elsewhere.getBounds()).toEqual({ x: 100, y: 100, width: 253, height: 220 });
  });

  it("keeps pushing while the pointer chases the note", () => {
    const note = createFakeWindow();
    const service = createService([note]);
    cursor = { x: 700, y: 500 };
    service.start();
    advance(800);
    const first = note.getBounds();
    expect(insideField(first)).toBe(false);

    // 鼠标追到便签的新位置, 便签要再让开.
    cursor = { x: first.x + 40, y: first.y + 40 };
    advance(800);

    expect(insideField(note.getBounds())).toBe(false);
    expect(note.getBounds()).not.toEqual(first);
  });

  it("moves the note back once the pointer leaves the area", () => {
    const note = createFakeWindow();
    const service = createService([note]);
    cursor = { x: 700, y: 500 };
    service.start();
    advance(800);
    expect(note.getBounds()).not.toEqual(noteBounds);

    cursor = { x: 120, y: 820 };
    advance(1200);

    expect(note.getBounds()).toEqual(noteBounds);
    expect(note.ignoring).toBe(false);
  });

  it("keeps the note aside while the pointer stays near its origin", () => {
    const note = createFakeWindow();
    const service = createService([note]);
    cursor = { x: 700, y: 500 };
    service.start();
    advance(800);
    expect(note.getBounds()).not.toEqual(noteBounds);

    // 鼠标退到便签原位左侧: 已离开立场圆, 但还在加宽的去抖圈内, 便签应继续让开而不是回原位.
    cursor = { x: 435, y: 500 };
    advance(600);
    expect(note.getBounds()).not.toEqual(noteBounds);
    expect(insideField(note.getBounds())).toBe(false);

    // 再远一些, 完全离开去抖圈, 才回到原位.
    cursor = { x: 380, y: 500 };
    advance(800);
    expect(note.getBounds()).toEqual(noteBounds);
  });

  it("releases the note when it gains focus", () => {
    const note = createFakeWindow();
    const service = createService([note]);
    cursor = { x: 700, y: 500 };
    service.start();
    advance(200);
    expect(note.getBounds()).not.toEqual(noteBounds);

    // 避让途中便签被点中: 立刻回原位并退出托管, 把窗口交给后续的收起/展开等操作.
    focused = note;
    advance(400);

    expect(note.getBounds()).toEqual(noteBounds);
    expect(note.ignoring).toBe(false);
  });

  it("keeps a released window out of the field until the next hold", () => {
    const note = createFakeWindow();
    const service = createService([note]);
    cursor = { x: 700, y: 500 };
    service.start();
    advance(200);
    expect(note.getBounds()).not.toEqual(noteBounds);

    // 用户开始拖动/收起等操作时释放该窗口: 回到原位, 本轮按住期间不再推开.
    service.release(note);
    expect(note.getBounds()).toEqual(noteBounds);

    advance(400);
    expect(note.getBounds()).toEqual(noteBounds);
    expect(note.ignoring).toBe(false);
  });

  it("returns every note to its exact original position when released", () => {
    const first = createFakeWindow();
    const second = createFakeWindow({ x: 200, y: 300, width: 253, height: 220 });
    const service = createService([first, second]);
    cursor = { x: 700, y: 500 };
    service.start();
    advance(800);

    service.finish();
    advance(1500);

    expect(first.getBounds()).toEqual(noteBounds);
    expect(second.getBounds()).toEqual({ x: 200, y: 300, width: 253, height: 220 });
    expect(first.ignoring).toBe(false);
    expect(service.isActive()).toBe(false);
  });

  it("restores positions immediately when disposed", () => {
    const note = createFakeWindow();
    const service = createService([note]);
    cursor = { x: 700, y: 500 };
    service.start();
    advance(200);

    service.dispose();

    expect(note.getBounds()).toEqual(noteBounds);
    expect(note.ignoring).toBe(false);
    expect(service.isActive()).toBe(false);
  });

  it("stops tracking a window that was closed", () => {
    const note = createFakeWindow();
    const service = createService([note]);
    cursor = { x: 700, y: 500 };
    service.start();
    advance(200);

    note.destroyed = true;
    service.forget(note);
    advance(100);

    expect(service.isActive()).toBe(false);
  });

  it("does nothing when there are no notes", () => {
    const service = createService([]);

    expect(service.start()).toBe(false);
    expect(service.isActive()).toBe(false);
  });
});
