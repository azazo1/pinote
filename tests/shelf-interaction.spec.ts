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
    let first = await createNote(app, main);
    let second = await createNote(app, main);
    const firstId = noteId(first);
    const secondId = noteId(second);
    const firstUrl = first.url();
    const secondUrl = second.url();

    const firstDockedClosed = first.waitForEvent("close");
    await first.evaluate((id) => window.noteAPI.dockNote(id), firstId);
    await firstDockedClosed;
    const shelf = await waitForWindow(app, "view=shelf");
    const secondDockedClosed = second.waitForEvent("close");
    await second.evaluate((id) => window.noteAPI.dockNote(id), secondId);
    await secondDockedClosed;
    await expect(shelf.locator(".note-list-item")).toHaveCount(2);
    await expect.poll(() => shelf.evaluate(() => window.innerWidth)).toBe(36);
    await expect.poll(() => isWindowVisible(app, firstUrl)).toBe(false);
    await expect.poll(() => isWindowVisible(app, secondUrl)).toBe(false);

    await shelf.getByLabel("展开侧边便签架").click();
    await expect(shelf.locator(".shelf-repeat-click-guard")).toHaveCount(1);
    await expect.poll(() => shelf.evaluate(() => window.innerWidth)).toBe(200);
    await expect(shelf.locator(".shelf-repeat-click-guard")).toHaveCount(0, { timeout: 1_000 });

    await shelf.locator(`[data-note-id="${firstId}"] .note-list-item`).click();
    await expect.poll(() => shelf.evaluate(() => window.innerWidth)).toBeGreaterThan(200);
    await expect(shelf.locator(".shelf-editor .title-input")).toHaveValue("侧边架测试便签");
    await expect.poll(() => app.evaluate(({ BrowserWindow }, id) => (
      BrowserWindow.getAllWindows().some((candidate) => candidate.webContents.getURL().includes(`noteId=${id}`))
    ), firstId)).toBe(false);

    const existingIds = await shelf.evaluate(async () => (await window.noteAPI.listNotes(true)).map((note) => note.id));
    await shelf.getByRole("button", { name: "新建便签" }).click();
    await expect(shelf.locator(".note-list-item")).toHaveCount(3);
    const createdId = await shelf.evaluate(async (ids) => (
      (await window.noteAPI.listNotes(true)).find((note) => !ids.includes(note.id))?.id ?? null
    ), existingIds);
    if (!createdId) throw new Error("侧边栏新建便签 id 不存在");
    await expect(shelf.locator(".shelf-editor .title-input")).toBeVisible();
    await expect.poll(() => app.evaluate(({ BrowserWindow }, id) => (
      BrowserWindow.getAllWindows().some((candidate) => candidate.webContents.getURL().includes(`noteId=${id}`))
    ), createdId)).toBe(false);
    const createdCloseButton = shelf.locator(`[data-note-id="${createdId}"] .note-list-close`);
    await createdCloseButton.click();
    await expect(createdCloseButton).toHaveClass(/is-confirming/);
    await createdCloseButton.click();
    await expect(shelf.locator(".note-list-item")).toHaveCount(2);

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

    await shelf.evaluate(() => window.noteAPI.setShelfExpanded(true));
    await expect.poll(() => shelf.evaluate(() => window.innerWidth)).toBe(200);
    const focusedBeforeDrag = await focusedWindowUrl(app);
    await beginShelfNoteDrag(shelf, firstId, 41);
    await expect.poll(() => app.windows().some((page) => page.url().includes(`noteId=${firstId}`))).toBe(true);
    await endShelfNoteDrag(shelf, firstId, 41);
    await expect.poll(() => readDockState(shelf, firstId)).toBe("free");
    first = await waitForWindow(app, `noteId=${firstId}`);
    await expect(first.locator(".note-shell")).toBeVisible();
    expect(await focusedWindowUrl(app)).toBe(focusedBeforeDrag);
    if (platform === "darwin") {
      expect(await app.evaluate(({ BrowserWindow }, url) => {
        return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.isFullScreen();
      }, main.url())).toBe(true);
    }

    await shelf.evaluate(() => window.noteAPI.setShelfExpanded(false));
    await expect.poll(() => shelf.evaluate(() => window.innerWidth)).toBe(36);
    const ball = await shelfBounds(app);
    const firstFreeUrl = first.url();
    const noteBeforeDrop = await noteWindowState(app, firstFreeUrl);
    await moveFreeNoteTo(first, firstId, ball, 51);
    await startWindowBoundsRecording(app, firstFreeUrl);
    const dockedAgainClosed = first.waitForEvent("close");
    await endFreeNoteMove(first, 51);
    await expect.poll(() => readDockState(shelf, firstId)).toBe("shelf");
    await dockedAgainClosed;
    const transitionBounds = await readWindowBoundsRecording(app);
    expect(transitionBounds.some((bounds) => bounds.height < noteBeforeDrop.bounds!.height)).toBe(true);
    await expect.poll(() => isWindowVisible(app, firstFreeUrl)).toBe(false);

    await shelf.evaluate(() => window.noteAPI.setShelfExpanded(true));
    await expect.poll(() => shelf.evaluate(() => window.innerWidth)).toBe(200);
    await shelf.locator(`[data-note-id="${firstId}"] .note-list-item`).click();
    await expect.poll(() => shelf.evaluate(() => window.innerWidth)).toBeGreaterThan(200);
    const draggedMarkdown = "从内嵌便签标题栏拖出的内容";
    await shelf.locator(".shelf-editor .note-editor .cm-content").fill(draggedMarkdown);
    await beginShelfEditorNoteDrag(shelf, 61);
    await expect.poll(() => app.windows().some((page) => page.url().includes(`noteId=${firstId}`))).toBe(true);
    await endShelfEditorNoteDrag(shelf, 61);
    await expect.poll(() => readDockState(shelf, firstId)).toBe("free");
    first = await waitForWindow(app, `noteId=${firstId}`);
    await expect(first.locator(".note-shell")).toBeVisible();
    await expect(first.locator(".note-editor .cm-content")).toHaveText(draggedMarkdown);

    await shelf.locator(`[data-note-id="${secondId}"] .note-list-close`).click();
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
  const note = app.windows().find((page) => page.url().includes("noteId=") && !existing.has(page.url()))!;
  await note.locator(".title-input").fill("侧边架测试便签");
  return note;
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

async function beginShelfEditorNoteDrag(shelf: Page, pointerId: number) {
  await shelf.locator(".shelf-editor .title-bar").evaluate((titleBar, input) => {
    const bar = titleBar as HTMLElement;
    bar.setPointerCapture = () => {};
    bar.hasPointerCapture = () => false;
    bar.releasePointerCapture = () => {};
    const bounds = bar.getBoundingClientRect();
    const screenX = window.screenX + bounds.left + 24;
    const screenY = window.screenY + bounds.top + bounds.height / 2;
    bar.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      isPrimary: true,
      pointerId: input.pointerId,
      screenX,
      screenY,
    }));
    bar.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      buttons: 1,
      isPrimary: true,
      pointerId: input.pointerId,
      screenX: screenX + (window.screenX > 400 ? -260 : 260),
      screenY: screenY + 80,
    }));
  }, { pointerId });
}

async function endShelfEditorNoteDrag(shelf: Page, pointerId: number) {
  await shelf.locator(".shelf-editor .title-bar").evaluate((titleBar, input) => {
    titleBar.dispatchEvent(new PointerEvent("pointerup", {
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

function startWindowBoundsRecording(app: ElectronApplication, url: string) {
  return app.evaluate(({ BrowserWindow }, targetUrl) => {
    const testState = globalThis as typeof globalThis & {
      __pinoteShelfTransitionSamples?: Electron.Rectangle[];
      __pinoteShelfTransitionTimer?: ReturnType<typeof setInterval>;
    };
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === targetUrl);
    if (!window) throw new Error("待收纳便签窗口不存在");
    if (testState.__pinoteShelfTransitionTimer) clearInterval(testState.__pinoteShelfTransitionTimer);
    testState.__pinoteShelfTransitionSamples = [window.getBounds()];
    testState.__pinoteShelfTransitionTimer = setInterval(() => {
      if (window.isDestroyed()) {
        clearInterval(testState.__pinoteShelfTransitionTimer);
        testState.__pinoteShelfTransitionTimer = undefined;
        return;
      }
      testState.__pinoteShelfTransitionSamples?.push(window.getBounds());
    }, 8);
    window.once("closed", () => {
      clearInterval(testState.__pinoteShelfTransitionTimer);
      testState.__pinoteShelfTransitionTimer = undefined;
    });
  }, url);
}

function readWindowBoundsRecording(app: ElectronApplication) {
  return app.evaluate(() => {
    const testState = globalThis as typeof globalThis & {
      __pinoteShelfTransitionSamples?: Electron.Rectangle[];
    };
    const samples = testState.__pinoteShelfTransitionSamples ?? [];
    testState.__pinoteShelfTransitionSamples = undefined;
    return samples;
  });
}
