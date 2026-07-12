import { _electron as electron, expect, test } from "playwright/test";
import path from "node:path";

test("关键便签窗口流程", async () => {
  const app = await electron.launch({
    args: ["."],
    cwd: path.resolve("."),
    env: { ...process.env, PINOTE_USER_DATA: `/private/tmp/pinote-e2e-${Date.now()}` },
  });
  try {
    await expect.poll(() => app.windows().some((page) => page.url().includes("noteId="))).toBe(true);
    const window = app.windows().find((page) => page.url().includes("noteId="));
    expect(window).toBeTruthy();
    if (!window) throw new Error("便签窗口未创建");
    window.on("console", (message) => {
      if (message.type() === "error") console.error(`renderer console: ${message.text()}`);
    });
    window.on("pageerror", (error) => console.error(`renderer pageerror: ${error.message}`));
    await window.reload({ waitUntil: "domcontentloaded" });

    const shell = window.locator(".note-shell");
    await expect(shell).toBeVisible();
    await expect(window.locator(".title-input")).toBeVisible();
    await expect(window.locator(".note-editor .cm-content")).toBeVisible();
    await expect(window.locator(".note-footer")).toBeVisible();

    const fit = await window.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.width);
    expect(fit.scrollHeight).toBeLessThanOrEqual(fit.height);

    const editor = window.locator(".note-editor .cm-content");
    await editor.fill("# QA\n\n- [ ] item\n\n**bold**");
    await expect(window.locator(".cm-md-heading-1")).toBeVisible();
    await expect(window.locator(".cm-md-task-checkbox")).toBeVisible();
    await window.screenshot({ path: "/private/tmp/pinote-expanded.png" });

    await window.getByLabel("置顶").click();
    await expect(window.getByLabel("置顶")).toHaveClass(/is-active/);
    await window.getByLabel("置顶").click();

    await window.getByLabel("同步设置").click();
    await expect(window.locator(".sync-panel")).toBeVisible();
    await window.screenshot({ path: "/private/tmp/pinote-sync-panel.png" });
    await window.getByLabel("关闭").click();

    const windowCount = app.windows().length;
    await window.getByLabel("新建便签").click();
    await expect.poll(() => app.windows().length).toBe(windowCount + 1);

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
    await window.getByLabel("侧边吸附便签组").click();
    await expect.poll(() => app.windows().some((page) => page.url().includes("view=shelf"))).toBe(true);
    const shelf = app.windows().find((page) => page.url().includes("view=shelf"));
    expect(shelf).toBeTruthy();
    const collapsedShelfBounds = await app.evaluate(({ BrowserWindow, screen }) => {
      const shelfWindow = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes("view=shelf"));
      if (!shelfWindow) return undefined;
      const bounds = shelfWindow.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      return { ...bounds, rightGap: area.x + area.width - bounds.x - bounds.width };
    });
    expect(collapsedShelfBounds).toMatchObject({ width: 36, height: 36, rightGap: 0 });
    await shelf!.screenshot({ path: "/private/tmp/pinote-shelf-collapsed.png" });
    await expect(shelf!.locator(".shelf-handle")).toHaveCSS("width", "18px");
    await shelf!.locator(".shelf-shell").hover({ position: { x: 28, y: 18 } });
    await expect.poll(() => shelf!.evaluate(() => window.innerWidth)).toBe(200);
    await expect(shelf!.locator(".shelf-content")).toBeVisible();
    await expect(shelf!.locator(".note-list-item")).toHaveCount(windowCount + 1);
    await shelf!.screenshot({ path: "/private/tmp/pinote-shelf.png" });
    await shelf!.getByLabel("离开侧边聚群").click();
  } finally {
    await app.close();
  }
});
