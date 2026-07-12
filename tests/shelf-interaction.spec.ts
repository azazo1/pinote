import { _electron as electron, expect, test, type ElectronApplication, type Page } from "playwright/test";
import path from "node:path";

test("侧边架全屏拖放和收纳动画", async () => {
  const app = await electron.launch({
    args: ["."],
    cwd: path.resolve("."),
    env: { ...process.env, PINOTE_USER_DATA: `/private/tmp/pinote-shelf-e2e-${Date.now()}` },
  });

  try {
    const main = await waitForWindow(app, "view=main");
    const first = await createNote(app, main);
    const second = await createNote(app, main);
    const firstId = noteId(first);
    const secondId = noteId(second);

    await first.evaluate((id) => window.noteAPI.toggleNoteDock(id), firstId);
    const shelf = await waitForWindow(app, "view=shelf");
    await second.evaluate((id) => window.noteAPI.toggleNoteDock(id), secondId);
    await expect(shelf.locator(".note-list-item")).toHaveCount(2);

    await expect.poll(() => shelf.evaluate(() => window.innerWidth)).toBe(36);
    await shelf.locator(".shelf-shell").hover({ position: { x: 28, y: 18 } });
    await expect.poll(() => shelf.evaluate(() => window.innerWidth), { timeout: 2_500 }).toBe(200);

    const platform = await app.evaluate(() => process.platform);
    if (platform === "darwin") {
      await app.evaluate(({ BrowserWindow }, url) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url);
        window?.setFullScreen(true);
      }, main.url());
      await expect.poll(() => app.evaluate(({ BrowserWindow }, url) => {
        return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.isFullScreen();
      }, main.url()), { timeout: 5_000 }).toBe(true);
    }

    const focusedBeforeDrag = await focusedWindowUrl(app);
    await beginShelfNoteDrag(shelf, firstId, 41);
    await shelf.evaluate(() => window.noteAPI.setShelfExpanded(false));
    await shelf.waitForTimeout(80);
    expect(await shelf.evaluate(() => window.innerWidth)).toBe(200);
    await expect.poll(() => isWindowVisible(app, first.url())).toBe(true);
    await endShelfNoteDrag(shelf, firstId, 41);
    await expect.poll(() => readDockState(first, firstId)).toBe("free");
    await expect.poll(() => isWindowVisible(app, first.url())).toBe(true);
    expect(await focusedWindowUrl(app)).toBe(focusedBeforeDrag);
    if (platform === "darwin") {
      expect(await app.evaluate(({ BrowserWindow }, url) => {
        return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.isFullScreen();
      }, main.url())).toBe(true);
    }

    const freeBounds = (await noteWindowState(app, first.url())).bounds!;
    await moveFreeNoteTo(first, firstId, freeBounds, 45);
    await shelf.evaluate(() => window.noteAPI.setShelfExpanded(false));
    await shelf.waitForTimeout(80);
    expect(await shelf.evaluate(() => window.innerWidth)).toBe(200);
    await endFreeNoteMove(first, 45);

    await shelf.evaluate(() => window.noteAPI.setShelfExpanded(false));
    await expect.poll(() => shelf.evaluate(() => window.innerWidth)).toBe(36);
    const ball = await shelfBounds(app);
    const noteBeforeDrop = await noteWindowState(app, first.url());
    await moveFreeNoteTo(first, firstId, ball, 51);
    expect(await readDockState(first, firstId)).toBe("free");
    await endFreeNoteMove(first, 51);
    await expect.poll(() => readDockState(first, firstId)).toBe("shelf");
    expect(await shelf.evaluate(() => window.innerWidth)).toBe(36);
    await first.waitForTimeout(50);
    const shrinking = await noteWindowState(app, first.url());
    expect(shrinking.visible).toBe(true);
    expect(shrinking.bounds!.height).toBeLessThan(noteBeforeDrop.bounds!.height);
    await shelf.waitForTimeout(300);
    expect(await shelf.evaluate(() => window.innerWidth)).toBe(36);
    await expect.poll(() => shelf.evaluate(() => window.innerWidth)).toBe(200);
    await expect.poll(() => isWindowVisible(app, first.url())).toBe(false);
    await expect(shelf.locator(".note-list-item")).toHaveCount(2);

    await beginShelfNoteDrag(shelf, firstId, 61);
    await endShelfNoteDrag(shelf, firstId, 61);
    await expect.poll(() => readDockState(first, firstId)).toBe("free");
    await expect.poll(() => isWindowVisible(app, first.url())).toBe(true);

    await shelf.locator(`[data-note-id="${secondId}"] .note-list-close`).click();
    await expect.poll(() => first.evaluate(async (id) => {
      const note = (await window.noteAPI.getNote(id)).note;
      return note ? { dockState: note.dockState, open: note.open } : null;
    }, secondId)).toEqual({ dockState: "free", open: false });
    await expect.poll(() => app.windows().some((page) => page.url().includes("view=shelf"))).toBe(false);
  } finally {
    await app.close();
  }
});

async function createNote(app: ElectronApplication, main: Page) {
  const existing = new Set(app.windows().map((page) => page.url()));
  await main.locator(".main-create-button").click();
  await expect.poll(() => app.windows().find((page) => page.url().includes("noteId=") && !existing.has(page.url()))).toBeTruthy();
  return app.windows().find((page) => page.url().includes("noteId=") && !existing.has(page.url()))!;
}

async function waitForWindow(app: ElectronApplication, query: string) {
  await expect.poll(() => app.windows().find((page) => page.url().includes(query))).toBeTruthy();
  return app.windows().find((page) => page.url().includes(query))!;
}

function noteId(page: Page) {
  const id = new URL(page.url()).searchParams.get("noteId");
  if (!id) throw new Error("便签 id 不存在");
  return id;
}

async function beginShelfNoteDrag(shelf: Page, id: string, pointerId: number) {
  await shelf.locator(`[data-note-id="${id}"]`).evaluate((item, input) => {
    const row = item.querySelector<HTMLButtonElement>(".note-list-item");
    if (!row) throw new Error("侧边便签按钮不存在");
    const list = row.closest<HTMLElement>(".note-list");
    if (!list) throw new Error("侧边便签列表不存在");
    list.setPointerCapture = () => {};
    list.hasPointerCapture = () => false;
    list.releasePointerCapture = () => {};
    const screenX = window.screenX + 90;
    const screenY = window.screenY + row.getBoundingClientRect().top + 16;
    row.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      isPrimary: true,
      pointerId: input.pointerId,
      screenX,
      screenY,
    }));
    list.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      buttons: 1,
      isPrimary: true,
      pointerId: input.pointerId,
      screenX: screenX + (window.screenX > 400 ? -260 : 260),
      screenY: screenY + 80,
    }));
  }, { pointerId });
}

async function endShelfNoteDrag(shelf: Page, id: string, pointerId: number) {
  await shelf.locator(`[data-note-id="${id}"]`).evaluate((item, input) => {
    item.closest<HTMLElement>(".note-list")?.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      buttons: 0,
      isPrimary: true,
      pointerId: input.pointerId,
    }));
  }, { pointerId });
}

async function moveFreeNoteTo(note: Page, id: string, target: Electron.Rectangle, pointerId: number) {
  await note.locator(".title-bar").evaluate((titleBar, input) => {
    const bar = titleBar as HTMLElement;
    bar.setPointerCapture = () => {};
    const startX = window.screenX + 80;
    const startY = window.screenY + 8;
    bar.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      isPrimary: true,
      pointerId: input.pointerId,
      screenX: startX,
      screenY: startY,
    }));
    bar.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      buttons: 1,
      isPrimary: true,
      pointerId: input.pointerId,
      screenX: input.target.x + input.target.width / 2,
      screenY: input.target.y + input.target.height / 2,
    }));
  }, { pointerId, target });
}

async function endFreeNoteMove(note: Page, pointerId: number) {
  await note.locator(".title-bar").evaluate((titleBar, input) => {
    titleBar.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      button: 0,
      buttons: 0,
      isPrimary: true,
      pointerId: input.pointerId,
    }));
  }, { pointerId });
}

function readDockState(note: Page, id: string) {
  return note.evaluate(async (noteId) => (await window.noteAPI.getNote(noteId)).note?.dockState, id);
}

function isWindowVisible(app: ElectronApplication, url: string) {
  return app.evaluate(({ BrowserWindow }, targetUrl) => (
    BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === targetUrl)?.isVisible() ?? false
  ), url);
}

function focusedWindowUrl(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.webContents.getURL() ?? null);
}

function shelfBounds(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find((candidate) => candidate.webContents.getURL().includes("view=shelf"))!.getBounds());
}

function noteWindowState(app: ElectronApplication, url: string) {
  return app.evaluate(({ BrowserWindow }, targetUrl) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === targetUrl);
    return { bounds: window?.getBounds(), visible: window?.isVisible() ?? false };
  }, url);
}
