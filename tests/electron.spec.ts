import { _electron as electron, expect, test } from "playwright/test";
import path from "node:path";

test("主窗口和便签窗口关键流程", async () => {
  const app = await electron.launch({
    args: ["."],
    cwd: path.resolve("."),
    env: { ...process.env, PINOTE_USER_DATA: `/private/tmp/pinote-e2e-${Date.now()}` },
  });
  try {
    await expect.poll(() => app.windows().some((page) => page.url().includes("view=main"))).toBe(true);
    const mainWindow = app.windows().find((page) => page.url().includes("view=main"));
    expect(mainWindow).toBeTruthy();
    if (!mainWindow) throw new Error("主窗口未创建");

    await expect(mainWindow.locator(".main-shell")).toBeVisible();
    await expect(mainWindow.getByText("还没有便签")).toBeVisible();
    await expect(mainWindow.locator(".main-note-row")).toHaveCount(0);
    await mainWindow.screenshot({ path: "/private/tmp/pinote-main-empty.png" });

    await mainWindow.locator(".main-create-button").click();
    await expect.poll(() => app.windows().filter((page) => page.url().includes("noteId=")).length).toBe(1);
    await expect(mainWindow.locator(".main-note-row")).toHaveCount(1);
    const window = app.windows().find((page) => page.url().includes("noteId="));
    expect(window).toBeTruthy();
    if (!window) throw new Error("便签窗口未创建");
    const firstNoteUrl = window.url();
    window.on("console", (message) => {
      if (message.type() === "error") console.error(`renderer console: ${message.text()}`);
    });
    window.on("pageerror", (error) => console.error(`renderer pageerror: ${error.message}`));

    const shell = window.locator(".note-shell");
    await expect(shell).toBeVisible();
    await expect(window.locator(".title-input")).toBeVisible();
    await expect(window.locator(".note-editor .cm-content")).toBeVisible();
    await expect(window.locator(".note-footer")).toBeVisible();

    const workspaceState = await app.evaluate(({ BrowserWindow }, url) => {
      const noteWindow = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url);
      return {
        platform: process.platform,
        visibleOnAllWorkspaces: noteWindow?.isVisibleOnAllWorkspaces(),
        alwaysOnTop: noteWindow?.isAlwaysOnTop(),
      };
    }, window.url());
    if (workspaceState.platform === "darwin") expect(workspaceState.visibleOnAllWorkspaces).toBe(true);
    expect(workspaceState.alwaysOnTop).toBe(false);

    const fit = await window.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.width);
    expect(fit.scrollHeight).toBeLessThanOrEqual(fit.height);

    await window.locator(".title-input").fill("QA 便签");
    const editor = window.locator(".note-editor .cm-content");
    await editor.fill("# QA\n\n- [ ] item\n\n**bold**");
    await expect(window.locator(".cm-md-heading-1")).toBeVisible();
    await expect(window.locator(".cm-md-task-checkbox")).toBeVisible();
    await expect(mainWindow.getByText("QA 便签")).toBeVisible();
    await window.screenshot({ path: "/private/tmp/pinote-expanded.png" });

    await window.getByLabel("置顶").click();
    await expect(window.getByLabel("置顶")).toHaveClass(/is-active/);
    await expect.poll(() => app.evaluate(({ BrowserWindow }, url) => {
      return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.isAlwaysOnTop();
    }, window.url())).toBe(true);
    await window.getByLabel("置顶").click();
    await expect.poll(() => app.evaluate(({ BrowserWindow }, url) => {
      return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.isAlwaysOnTop();
    }, window.url())).toBe(false);

    await window.getByLabel("便签操作").click();
    const menu = window.getByRole("menu", { name: "便签操作" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(5);
    await expect(menu.getByText("开始专注")).toHaveCount(0);
    await window.screenshot({ path: "/private/tmp/pinote-note-menu.png" });
    await menu.getByRole("menuitem", { name: "云同步" }).click();
    await expect(window.locator(".sync-panel")).toBeVisible();
    await window.screenshot({ path: "/private/tmp/pinote-sync-panel.png" });
    await window.locator(".sync-panel").getByLabel("关闭", { exact: true }).click();

    await window.getByLabel("便签操作").click();
    await window.getByRole("menuitem", { name: "新建便签" }).click();
    await expect.poll(() => app.windows().filter((page) => page.url().includes("noteId=")).length).toBe(2);
    await expect(mainWindow.locator(".main-note-row")).toHaveCount(2);
    const secondWindow = app.windows().find((page) => page.url().includes("noteId=") && page.url() !== firstNoteUrl);
    expect(secondWindow).toBeTruthy();
    if (!secondWindow) throw new Error("第二张便签窗口未创建");

    await app.evaluate(({ BrowserWindow }, input) => {
      BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === input.url)?.setSize(input.width, input.height);
    }, { url: window.url(), width: 360, height: 300 });
    await expect.poll(() => window.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))).toEqual({ width: 360, height: 300 });
    await window.locator(".title-bar").dblclick({ position: { x: 100, y: 8 } });
    await expect(shell).toHaveClass(/is-collapsed/);
    await window.waitForTimeout(150);
    const collapsedSize = await window.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    expect(collapsedSize).toEqual({ width: 253, height: 22 });
    await window.screenshot({ path: "/private/tmp/pinote-collapsed.png" });

    await window.locator(".title-bar").dblclick({ position: { x: 100, y: 8 } });
    await expect.poll(() => window.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))).toEqual({ width: 360, height: 300 });
    const resizable = await app.evaluate(({ BrowserWindow }, url) => {
      return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.isResizable();
    }, window.url());
    expect(resizable).toBe(true);

    await window.getByLabel("便签操作").click();
    await window.getByRole("menuitem", { name: "侧边聚群" }).click();
    await expect.poll(() => app.windows().some((page) => page.url().includes("view=shelf"))).toBe(true);
    const shelf = app.windows().find((page) => page.url().includes("view=shelf"));
    expect(shelf).toBeTruthy();
    await mainWindow.mouse.move(40, 120);
    await shelf!.evaluate(() => window.noteAPI.hideGroup());
    const readShelfBounds = () => app.evaluate(({ BrowserWindow, screen }) => {
      const shelfWindow = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes("view=shelf"));
      if (!shelfWindow) return undefined;
      const bounds = shelfWindow.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      return { ...bounds, rightGap: area.x + area.width - bounds.x - bounds.width };
    });
    await expect.poll(readShelfBounds).toMatchObject({ width: 36, height: 36, rightGap: 0 });
    const shelfBeforeDrag = await readShelfBounds();
    expect(shelfBeforeDrag).toBeTruthy();
    await shelf!.evaluate(() => {
      const handle = document.querySelector<HTMLButtonElement>(".shelf-handle");
      if (!handle) throw new Error("侧边把手不存在");
      handle.setPointerCapture = () => {};
      handle.hasPointerCapture = () => false;
      const pointerId = 17;
      const screenX = window.screenX + 28;
      const screenY = window.screenY + 18;
      handle.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        isPrimary: true,
        pointerId,
        screenX,
        screenY,
      }));
      handle.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        isPrimary: true,
        pointerId,
        screenX,
        screenY: screenY + 80,
      }));
    });
    await expect(shelf!.locator(".shelf-shell")).toHaveClass(/is-dragging/);
    await expect.poll(readShelfBounds).toMatchObject({ width: 36, height: 36, rightGap: 0 });
    const movedShelfBounds = await readShelfBounds();
    expect(movedShelfBounds!.y).toBeGreaterThan(shelfBeforeDrag!.y + 30);
    await shelf!.evaluate(() => {
      const handle = document.querySelector<HTMLButtonElement>(".shelf-handle");
      if (!handle) throw new Error("侧边把手不存在");
      handle.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        isPrimary: true,
        pointerId: 17,
      }));
    });
    await expect(shelf!.locator(".shelf-shell")).not.toHaveClass(/is-dragging/);
    await shelf!.screenshot({ path: "/private/tmp/pinote-shelf-collapsed.png" });
    await expect(shelf!.getByLabel("展开侧边便签架")).toHaveCSS("width", "18px");
    await shelf!.locator(".shelf-shell").hover({ position: { x: 28, y: 18 } });
    await expect.poll(() => shelf!.evaluate(() => window.innerWidth)).toBe(200);
    const shelfExpandedBounds = await readShelfBounds();
    expect(Math.abs(
      shelfExpandedBounds!.y + shelfExpandedBounds!.height / 2
      - (movedShelfBounds!.y + movedShelfBounds!.height / 2),
    )).toBeLessThanOrEqual(2);
    await expect(shelf!.locator(".shelf-content")).toBeVisible();
    await expect(shelf!.locator(".note-list-item")).toHaveCount(2);
    await shelf!.screenshot({ path: "/private/tmp/pinote-shelf.png" });
    await shelf!.getByLabel("离开侧边聚群").click();

    const firstClosed = window.waitForEvent("close");
    await window.getByLabel("关闭便签").click();
    await firstClosed;
    await expect(mainWindow.locator(".main-note-row")).toHaveCount(2);
    const closedRow = mainWindow.locator(".main-note-row").filter({ hasText: "QA 便签" });
    await expect(closedRow).toHaveCount(1);
    await expect(closedRow.locator(".main-note-open-state")).toHaveCount(0);

    await closedRow.locator(".main-note-open").click();
    await expect.poll(() => app.windows().some((page) => page.url() === firstNoteUrl)).toBe(true);
    const reopenedWindow = app.windows().find((page) => page.url() === firstNoteUrl);
    expect(reopenedWindow).toBeTruthy();
    await expect(reopenedWindow!.locator(".title-input")).toHaveValue("QA 便签");

    await app.evaluate(({ dialog }) => {
      Object.defineProperty(dialog, "showMessageBox", {
        configurable: true,
        value: async () => ({ response: 1, checkboxChecked: false }),
      });
    });
    const secondClosed = secondWindow.waitForEvent("close");
    await secondWindow.getByLabel("便签操作").click();
    await secondWindow.getByRole("menuitem", { name: "删除便签" }).click();
    await secondClosed;
    await expect(mainWindow.locator(".main-note-row")).toHaveCount(1);
    await expect(mainWindow.getByText("QA 便签")).toBeVisible();
    await mainWindow.screenshot({ path: "/private/tmp/pinote-main.png" });

    const readMainState = () => app.evaluate(({ BrowserWindow }, url) => {
      const main = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url);
      return { visible: main?.isVisible(), minimized: main?.isMinimized(), destroyed: main?.isDestroyed() };
    }, mainWindow.url());
    await app.evaluate(({ BrowserWindow }, url) => {
      BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.close();
    }, mainWindow.url());
    await expect.poll(readMainState).toMatchObject({ visible: false, minimized: false, destroyed: false });
    expect(mainWindow.isClosed()).toBe(false);

    await reopenedWindow!.getByLabel("便签操作").click();
    await reopenedWindow!.getByRole("menuitem", { name: "打开主窗口" }).click();
    await expect.poll(readMainState).toMatchObject({ visible: true, minimized: false, destroyed: false });
  } finally {
    await app.close();
  }
});
