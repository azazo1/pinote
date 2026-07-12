import { _electron as electron, expect, test, type Page } from "playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

test("主窗口和便签窗口关键流程", async () => {
  const app = await electron.launch({
    args: ["."],
    cwd: path.resolve("."),
    env: { ...process.env, PINOTE_USER_DATA: `/private/tmp/pinote-e2e-${Date.now()}` },
  });
  try {
    async function triggerShortcut(page: Page, id: string) {
      await page.bringToFront();
      await app.evaluate(({ BrowserWindow, Menu }, input) => {
        const target = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === input.url);
        const item = Menu.getApplicationMenu()?.getMenuItemById(input.id);
        if (!target || !item?.click) throw new Error(`快捷键菜单项不可用: ${input.id}`);
        target.focus();
        item.click(item, target, {});
      }, { id, url: page.url() });
    }

    await expect.poll(() => app.windows().some((page) => page.url().includes("view=main"))).toBe(true);
    const mainWindow = app.windows().find((page) => page.url().includes("view=main"));
    expect(mainWindow).toBeTruthy();
    if (!mainWindow) throw new Error("主窗口未创建");

    const mainWorkspaceState = await app.evaluate(({ BrowserWindow }, url) => {
      const main = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url);
      return {
        platform: process.platform,
        alwaysOnTop: main?.isAlwaysOnTop(),
        visibleOnAllWorkspaces: main?.isVisibleOnAllWorkspaces(),
      };
    }, mainWindow.url());
    expect(mainWorkspaceState.alwaysOnTop).toBe(false);
    if (mainWorkspaceState.platform === "darwin") expect(mainWorkspaceState.visibleOnAllWorkspaces).toBe(false);

    await expect(mainWindow.locator(".main-shell")).toBeVisible();
    await expect(mainWindow.getByText("还没有便签")).toBeVisible();
    await expect(mainWindow.locator(".main-note-row")).toHaveCount(0);
    const accelerators = await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      const ids = [
        "open-main-window",
        "new-note",
        "close-window",
        "focus-title",
        "focus-editor",
        "toggle-collapse",
        "toggle-pin",
        "toggle-dock",
        "toggle-color-picker",
        "toggle-metadata",
        "focus-search",
        "toggle-sync",
      ];
      return Object.fromEntries(ids.map((id) => [id, menu?.getMenuItemById(id)?.accelerator]));
    });
    expect(accelerators).toEqual({
      "open-main-window": "CommandOrControl+0",
      "new-note": process.platform === "darwin" ? "Command+N" : "Control+Shift+N",
      "close-window": "CommandOrControl+W",
      "focus-title": "CommandOrControl+1",
      "focus-editor": "CommandOrControl+2",
      "toggle-collapse": "CommandOrControl+M",
      "toggle-pin": "CommandOrControl+Shift+P",
      "toggle-dock": "CommandOrControl+Shift+D",
      "toggle-color-picker": "CommandOrControl+Shift+C",
      "toggle-metadata": "CommandOrControl+Shift+T",
      "focus-search": process.platform === "darwin" ? "Command+F" : "Control+Shift+F",
      "toggle-sync": "CommandOrControl+,",
    });
    await triggerShortcut(mainWindow, "focus-search");
    await expect(mainWindow.locator(".main-search input")).toBeFocused();
    const trayTemplatePath = path.resolve("electron/assets/trayTemplate.png");
    const trayRetinaTemplatePath = path.resolve("electron/assets/trayTemplate@2x.png");
    const trayIconState = await app.evaluate(({ nativeImage }, input) => {
      const image = nativeImage.createFromBuffer(Buffer.from(input.standard, "base64"), { scaleFactor: 1 });
      image.addRepresentation({
        scaleFactor: 2,
        buffer: Buffer.from(input.retina, "base64"),
      });
      image.setTemplateImage(true);
      return {
        size: image.getSize(),
        scaleFactors: image.getScaleFactors(),
        template: image.isTemplateImage(),
      };
    }, {
      standard: readFileSync(trayTemplatePath).toString("base64"),
      retina: readFileSync(trayRetinaTemplatePath).toString("base64"),
    });
    expect(trayIconState.size).toEqual({ width: 16, height: 16 });
    expect(trayIconState.scaleFactors).toEqual(expect.arrayContaining([1, 2]));
    expect(trayIconState.template).toBe(true);
    await mainWindow.screenshot({ path: "/private/tmp/pinote-main-empty.png" });

    await mainWindow.locator(".main-create-button").click();
    await expect.poll(() => app.windows().filter((page) => page.url().includes("noteId=")).length).toBe(1);
    await expect(mainWindow.locator(".main-note-row")).toHaveCount(1);
    const window = app.windows().find((page) => page.url().includes("noteId="));
    expect(window).toBeTruthy();
    if (!window) throw new Error("便签窗口未创建");
    const firstNoteUrl = window.url();
    const firstNoteId = new URL(firstNoteUrl).searchParams.get("noteId");
    if (!firstNoteId) throw new Error("便签 id 不存在");
    window.on("console", (message) => {
      if (message.type() === "error") console.error(`renderer console: ${message.text()}`);
    });
    window.on("pageerror", (error) => console.error(`renderer pageerror: ${error.message}`));

    const shell = window.locator(".note-shell");
    await expect(shell).toBeVisible();
    await expect(window.locator(".title-input")).toBeVisible();
    await expect(window.locator(".note-editor .cm-content")).toBeVisible();
    await expect(window.locator(".note-footer")).toBeVisible();
    await triggerShortcut(window, "focus-title");
    await expect(window.locator(".title-input")).toBeFocused();
    await triggerShortcut(window, "focus-editor");
    await expect(window.locator(".note-editor .cm-content")).toBeFocused();
    await triggerShortcut(window, "toggle-color-picker");
    await expect(window.locator(".color-picker")).toBeVisible();
    await triggerShortcut(window, "toggle-color-picker");
    await expect(window.locator(".color-picker")).toHaveCount(0);

    const workspaceState = await app.evaluate(({ BrowserWindow }, url) => {
      const noteWindow = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url);
      return {
        platform: process.platform,
        wayland: process.platform === "linux" && (Boolean(process.env.WAYLAND_DISPLAY) || process.env.XDG_SESSION_TYPE?.toLowerCase() === "wayland"),
        visibleOnAllWorkspaces: noteWindow?.isVisibleOnAllWorkspaces(),
        alwaysOnTop: noteWindow?.isAlwaysOnTop(),
        resizable: noteWindow?.isResizable(),
      };
    }, window.url());
    if (workspaceState.platform === "darwin") expect(workspaceState.visibleOnAllWorkspaces).toBe(true);
    expect(workspaceState.alwaysOnTop).toBe(false);

    const resizeEdges = window.locator(".window-resize-handle");
    if (workspaceState.wayland) {
      await expect(resizeEdges).toHaveCount(0);
      expect(workspaceState.resizable).toBe(true);
    } else {
      await expect(resizeEdges).toHaveCount(7);
      await expect(window.locator('[data-resize-edge="ne"]')).toHaveCount(0);
      expect(workspaceState.resizable).toBe(false);
      const overlappingEdges = await window.evaluate(() => {
        const actions = document.querySelector(".window-actions")?.getBoundingClientRect();
        if (!actions) return ["missing-actions"];
        return [...document.querySelectorAll<HTMLElement>(".window-resize-handle")]
          .filter((handle) => {
            const bounds = handle.getBoundingClientRect();
            return bounds.left < actions.right && bounds.right > actions.left && bounds.top < actions.bottom && bounds.bottom > actions.top;
          })
          .map((handle) => handle.dataset.resizeEdge ?? "unknown");
      });
      expect(overlappingEdges).toEqual([]);

      const eastHandle = window.locator('[data-resize-edge="e"]');
      const eastBounds = await eastHandle.boundingBox();
      if (!eastBounds) throw new Error("右侧调整句柄不可用");
      const initialWidth = await window.evaluate(() => window.innerWidth);
      await window.mouse.move(eastBounds.x + 2, eastBounds.y + eastBounds.height / 2);
      await window.mouse.down();
      await window.mouse.move(eastBounds.x + 4, eastBounds.y + eastBounds.height / 2);
      await window.mouse.move(eastBounds.x + 26, eastBounds.y + eastBounds.height / 2, { steps: 4 });
      await window.mouse.up();
      await expect.poll(() => window.evaluate(() => window.innerWidth)).toBe(initialWidth + 24);
    }

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
    await editor.fill("- [ ]");
    await editor.press("End");
    await editor.press("Space");
    const firstSpaceCaretX = await window.evaluate(() => window.getSelection()?.getRangeAt(0).getBoundingClientRect().x);
    await editor.press("Space");
    const secondSpaceCaretX = await window.evaluate(() => window.getSelection()?.getRangeAt(0).getBoundingClientRect().x);
    expect(firstSpaceCaretX).toBeDefined();
    expect(secondSpaceCaretX).toBeDefined();
    expect(secondSpaceCaretX).toBeGreaterThan((firstSpaceCaretX ?? 0) + 1);
    await editor.fill("# QA\n\n- [ ] item with enough content to wrap onto another line in a compact note\n\n**bold**\n\nTags #Rust");
    const flushSucceeded = await app.evaluate(({ BrowserWindow, ipcMain }, url) => new Promise<boolean>((resolve) => {
      const target = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url);
      if (!target) {
        resolve(false);
        return;
      }
      const requestId = `e2e-flush-${Date.now()}`;
      const timeout = setTimeout(() => {
        ipcMain.removeListener("note:flush-complete", onComplete);
        resolve(false);
      }, 2_000);
      function onComplete(event: Electron.IpcMainEvent, receivedId: string, succeeded: boolean) {
        if (event.sender.id !== target.webContents.id || receivedId !== requestId) return;
        clearTimeout(timeout);
        ipcMain.removeListener("note:flush-complete", onComplete);
        resolve(succeeded);
      }
      ipcMain.on("note:flush-complete", onComplete);
      target.webContents.send("note:flush-request", requestId);
    }), window.url());
    expect(flushSucceeded).toBe(true);
    await expect(window.locator(".cm-md-heading-1")).toBeVisible();
    const inlineTag = window.locator(".cm-md-tag").filter({ hasText: "#Rust" });
    await expect(inlineTag).toBeVisible();
    await expect(inlineTag).toHaveCSS("font-weight", "620");
    await expect.poll(() => window.evaluate(async (id) => {
      return (await window.noteAPI.getNote(id)).note?.tags;
    }, firstNoteId)).toContain("Rust");
    const taskLine = window.locator(".cm-line").filter({ hasText: "item" });
    await taskLine.click();
    const taskCheckbox = taskLine.locator(".cm-md-task-checkbox");
    const taskMarker = taskLine.locator(".cm-md-task-marker");
    await expect(taskCheckbox).toBeVisible();
    await expect(taskMarker).toHaveCSS("display", "inline-flex");
    await expect(taskMarker).toHaveCSS("align-items", "center");
    await expect(taskMarker).toHaveCSS("width", "16px");
    await expect(taskCheckbox).toHaveCSS("appearance", "none");
    await expect(taskCheckbox).toHaveCSS("width", "12px");
    await expect(taskCheckbox).toHaveCSS("height", "12px");
    await expect(taskCheckbox).toHaveCSS("border-radius", "3px");
    await expect(taskLine).toHaveCSS("padding-left", "16px");
    await expect(taskLine).toHaveCSS("text-indent", "-16px");
    await expect(taskLine).not.toContainText("- [ ]");
    await window.screenshot({ path: "/private/tmp/pinote-task-unchecked.png" });
    await taskCheckbox.click();
    await expect(taskCheckbox).toBeChecked();
    await expect(taskLine).toHaveCSS("text-decoration-line", "line-through");
    await expect(taskLine).not.toContainText("- [x]");
    await expect.poll(() => window.evaluate(async (id) => {
      return (await window.noteAPI.getNote(id)).note?.markdown;
    }, firstNoteId)).toContain("- [x] item");
    await taskCheckbox.click();
    await expect(taskCheckbox).not.toBeChecked();
    await expect(taskLine).toHaveCSS("text-decoration-line", "none");
    await expect.poll(() => window.evaluate(async (id) => {
      return (await window.noteAPI.getNote(id)).note?.markdown;
    }, firstNoteId)).toContain("- [ ] item");
    await taskCheckbox.click();
    await expect(taskCheckbox).toBeChecked();
    await expect(mainWindow.getByText("QA 便签")).toBeVisible();
    await window.screenshot({ path: "/private/tmp/pinote-expanded.png" });

    await triggerShortcut(window, "toggle-metadata");
    const metadataPanel = window.locator(".note-metadata-panel");
    await expect(metadataPanel).toBeVisible();
    await metadataPanel.getByLabel("便签分组").fill("Work");
    await metadataPanel.getByLabel("便签分组").press("Enter");
    await metadataPanel.getByLabel("便签分组").fill("Ignored");
    await metadataPanel.getByLabel("便签分组").press("Escape");
    await expect(metadataPanel.getByLabel("便签分组")).toHaveValue("Work");
    await metadataPanel.getByLabel("添加标签").fill("#Electron");
    await metadataPanel.getByLabel("添加标签").press("Enter");
    await expect(metadataPanel.getByText("#Rust", { exact: true })).toBeVisible();
    await expect(metadataPanel.getByText("#Electron", { exact: true })).toBeVisible();
    await window.screenshot({ path: "/private/tmp/pinote-metadata-panel.png" });
    await metadataPanel.getByLabel("关闭分组与标签").click();
    await expect.poll(() => window.evaluate(async (id) => {
      const note = (await window.noteAPI.getNote(id)).note;
      return note ? { groupName: note.groupName, tags: note.tags } : null;
    }, firstNoteId)).toMatchObject({ groupName: "Work", tags: expect.arrayContaining(["Electron", "Rust"]) });
    await expect(mainWindow.locator(".main-note-group")).toHaveText("Work");
    await expect(mainWindow.locator(".main-note-tag")).toHaveCount(2);

    await triggerShortcut(window, "toggle-pin");
    await expect(window.getByLabel("置顶")).toHaveClass(/is-active/);
    await expect.poll(() => app.evaluate(({ BrowserWindow }, url) => {
      return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.isAlwaysOnTop();
    }, window.url())).toBe(true);
    await triggerShortcut(window, "toggle-pin");
    await expect.poll(() => app.evaluate(({ BrowserWindow }, url) => {
      return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.isAlwaysOnTop();
    }, window.url())).toBe(false);

    await window.getByLabel("便签操作").click();
    const menu = window.getByRole("menu", { name: "便签操作" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(5);
    await expect(menu.getByText("开始专注")).toHaveCount(0);
    await window.screenshot({ path: "/private/tmp/pinote-note-menu.png" });
    await menu.getByRole("menuitem", { name: "便签颜色" }).click();
    await expect(window.locator(".color-picker")).toBeVisible();
    await window.locator(".color-swatch").first().click();
    await expect(window.locator(".color-picker")).toHaveCount(0);
    await window.getByLabel("便签操作").click();
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "云同步" }).click();
    await expect(window.locator(".sync-panel")).toBeVisible();
    await window.screenshot({ path: "/private/tmp/pinote-sync-panel.png" });
    await window.locator(".sync-panel").getByLabel("关闭", { exact: true }).click();

    await triggerShortcut(window, "new-note");
    await expect.poll(() => app.windows().filter((page) => page.url().includes("noteId=")).length).toBe(2);
    await expect(mainWindow.locator(".main-note-row")).toHaveCount(2);
    let secondWindow = app.windows().find((page) => page.url().includes("noteId=") && page.url() !== firstNoteUrl);
    expect(secondWindow).toBeTruthy();
    if (!secondWindow) throw new Error("第二张便签窗口未创建");
    const secondNoteId = new URL(secondWindow.url()).searchParams.get("noteId");
    if (!secondNoteId) throw new Error("第二张便签 id 不存在");
    const secondNoteUrl = secondWindow.url();
    await expect.poll(() => app.evaluate(({ BrowserWindow }, url) => {
      return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.isVisible();
    }, secondWindow.url())).toBe(true);

    const search = mainWindow.getByLabel("搜索便签");
    await search.fill("#Rust");
    await expect(mainWindow.locator(".main-note-row")).toHaveCount(1);
    await search.fill("");
    await mainWindow.getByRole("button", { name: /Work 1/ }).click();
    await expect(mainWindow.locator(".main-note-row")).toHaveCount(1);
    await mainWindow.locator(".main-tag-filter").filter({ hasText: "Rust" }).click();
    await mainWindow.locator(".main-tag-filter").filter({ hasText: "Electron" }).click();
    await expect(mainWindow.locator(".main-note-row")).toHaveCount(1);
    await mainWindow.getByRole("button", { name: /全部 2/ }).click();
    await mainWindow.getByRole("button", { name: "清除", exact: true }).click();
    await expect(mainWindow.locator(".main-note-row")).toHaveCount(2);
    await mainWindow.screenshot({ path: "/private/tmp/pinote-main-metadata.png" });

    const snapFixture = await app.evaluate(({ BrowserWindow, screen }, input) => {
      const first = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === input.firstUrl);
      const second = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === input.secondUrl);
      if (!first || !second) throw new Error("磁吸测试窗口不存在");
      const area = screen.getDisplayMatching(first.getBounds()).workArea;
      const firstWidth = 360;
      const firstHeight = 300;
      const secondWidth = 253;
      const secondHeight = 220;
      const secondX = Math.min(area.x + 600, area.x + area.width - secondWidth - 30);
      const targetY = Math.min(area.y + 140, area.y + area.height - firstHeight - 30);
      first.setBounds({ x: secondX - firstWidth - 50, y: targetY + 40, width: firstWidth, height: firstHeight });
      second.setBounds({ x: secondX, y: targetY, width: secondWidth, height: secondHeight });
      return {
        attachedX: secondX - firstWidth,
        targetY,
        nearX: secondX - firstWidth - 8,
        nearY: targetY + 6,
        freeX: secondX - firstWidth - 60,
        freeY: targetY + 50,
        secondX,
        secondY: targetY,
        secondWidth,
        secondHeight,
      };
    }, { firstUrl: window.url(), secondUrl: secondWindow.url() });

    await window.evaluate(({ id, x, y }) => {
      window.noteAPI.beginWindowMove(id);
      window.noteAPI.moveWindow(id, x, y, x, y);
    }, {
      id: firstNoteId,
      x: snapFixture.nearX,
      y: snapFixture.nearY,
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }, url) => {
      return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.getBounds();
    }, window.url())).toMatchObject({ x: snapFixture.attachedX, y: snapFixture.targetY });

    await window.evaluate(({ id, x, y }) => {
      window.noteAPI.moveWindow(id, x, y, x, y);
      window.noteAPI.endWindowMove(id);
    }, {
      id: firstNoteId,
      x: snapFixture.freeX,
      y: snapFixture.freeY,
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }, url) => {
      return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.getBounds();
    }, window.url())).toMatchObject({ x: snapFixture.freeX, y: snapFixture.freeY });

    await app.evaluate(({ BrowserWindow }, input) => {
      BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === input.url)?.setSize(input.width, input.height);
    }, { url: window.url(), width: 360, height: 300 });
    await expect.poll(() => window.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))).toEqual({ width: 360, height: 300 });
    await triggerShortcut(window, "toggle-color-picker");
    await expect(window.locator(".color-picker")).toBeVisible();
    await triggerShortcut(window, "toggle-collapse");
    await expect(shell).toHaveClass(/is-collapsed/);
    await expect(window.locator(".color-picker")).toHaveCount(0);
    await window.waitForTimeout(150);
    const collapsedSize = await window.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    expect(collapsedSize).toEqual({ width: 253, height: 22 });
    await window.screenshot({ path: "/private/tmp/pinote-collapsed.png" });

    await triggerShortcut(window, "toggle-collapse");
    await expect.poll(() => window.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))).toEqual({ width: 360, height: 300 });
    const resizable = await app.evaluate(({ BrowserWindow }, url) => {
      return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.isResizable();
    }, window.url());
    expect(resizable).toBe(workspaceState.wayland);

    const readNoteDockState = (page: Page, id: string) => page.evaluate(async (noteId) => {
      return (await window.noteAPI.getNote(noteId)).note?.dockState;
    }, id);
    const readWindowVisible = (url: string) => app.evaluate(({ BrowserWindow }, targetUrl) => {
      return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === targetUrl)?.isVisible();
    }, url);
    const firstBeforeDock = await window.evaluate(async (id) => {
      const note = (await window.noteAPI.getNote(id)).note;
      return note ? { revision: note.revision, modifiedAt: note.modifiedAt } : null;
    }, firstNoteId);

    await triggerShortcut(window, "toggle-dock");
    await expect.poll(() => app.windows().some((page) => page.url().includes("view=shelf"))).toBe(true);
    const shelf = app.windows().find((page) => page.url().includes("view=shelf"));
    expect(shelf).toBeTruthy();
    const shelfWorkspaceState = await app.evaluate(({ BrowserWindow }) => {
      const shelfWindow = BrowserWindow.getAllWindows()
        .find((candidate) => candidate.webContents.getURL().includes("view=shelf"));
      return {
        platform: process.platform,
        alwaysOnTop: shelfWindow?.isAlwaysOnTop(),
        visibleOnAllWorkspaces: shelfWindow?.isVisibleOnAllWorkspaces(),
      };
    });
    expect(shelfWorkspaceState.alwaysOnTop).toBe(true);
    if (shelfWorkspaceState.platform === "darwin") expect(shelfWorkspaceState.visibleOnAllWorkspaces).toBe(true);
    await expect.poll(() => readNoteDockState(window, firstNoteId)).toBe("shelf");
    await expect.poll(() => readNoteDockState(secondWindow, secondNoteId)).toBe("free");
    await expect.poll(() => readWindowVisible(window.url())).toBe(false);
    await expect.poll(() => readWindowVisible(secondWindow.url())).toBe(true);
    const readShelfBounds = () => app.evaluate(({ BrowserWindow, screen }) => {
      const shelfWindow = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes("view=shelf"));
      if (!shelfWindow) return undefined;
      const bounds = shelfWindow.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      return {
        ...bounds,
        leftGap: bounds.x - area.x,
        rightGap: area.x + area.width - bounds.x - bounds.width,
      };
    });
    const readDockedLayout = () => app.evaluate(({ BrowserWindow, screen }, input) => {
      const noteWindow = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === input.noteUrl);
      const shelfWindow = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes("view=shelf"));
      const note = noteWindow?.getBounds();
      const shelf = shelfWindow?.getBounds();
      return {
        note,
        shelf,
        area: shelf ? screen.getDisplayMatching(shelf).workArea : undefined,
        noteVisible: noteWindow?.isVisible() ?? false,
      };
    }, { noteUrl: window.url() });
    const moveGroupAwayFromCursor = () => app.evaluate(({ BrowserWindow, screen }, input) => {
      const shelfWindow = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes("view=shelf"));
      const noteWindow = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === input.noteUrl);
      if (!shelfWindow) throw new Error("缺少侧边架测试窗口");
      const area = screen.getDisplayMatching(shelfWindow.getBounds()).workArea;
      const cursor = screen.getCursorScreenPoint();
      const moveAway = (target: Electron.BrowserWindow) => {
        const bounds = target.getBounds();
        const candidates = [
          { x: area.x, y: area.y },
          { x: area.x + area.width - bounds.width, y: area.y },
          { x: area.x, y: area.y + area.height - bounds.height },
          { x: area.x + area.width - bounds.width, y: area.y + area.height - bounds.height },
        ];
        const position = candidates.find((candidate) => (
          cursor.x < candidate.x ||
          cursor.x > candidate.x + bounds.width ||
          cursor.y < candidate.y ||
          cursor.y > candidate.y + bounds.height
        ));
        if (!position) throw new Error("找不到空闲的聚群测试位置");
        target.setPosition(position.x, position.y);
      };
      moveAway(shelfWindow);
      if (noteWindow?.isVisible()) moveAway(noteWindow);
    }, { noteUrl: window.url() });
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
    await expect(shelf!.getByLabel("展开侧边便签架")).toHaveCSS("box-shadow", "none");
    await shelf!.locator(".shelf-shell").hover({ position: { x: 28, y: 18 } });
    await shelf!.waitForTimeout(350);
    expect(await shelf!.evaluate(() => window.innerWidth)).toBe(36);
    await expect.poll(() => shelf!.evaluate(() => window.innerWidth)).toBe(200);
    const shelfExpandedBounds = await readShelfBounds();
    expect(Math.abs(
      shelfExpandedBounds!.y + shelfExpandedBounds!.height / 2
      - (movedShelfBounds!.y + movedShelfBounds!.height / 2),
    )).toBeLessThanOrEqual(2);
    await expect(shelf!.locator(".shelf-content")).toBeVisible();
    await expect(shelf!.getByLabel("移动侧边便签架")).toBeVisible();
    await expect(shelf!.locator(".shelf-heading strong")).toHaveCSS("user-select", "none");
    await app.evaluate(({ BrowserWindow }, url) => {
      BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.hide();
    }, mainWindow.url());
    await expect.poll(() => app.evaluate(({ BrowserWindow }, url) => {
      return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.isVisible();
    }, mainWindow.url())).toBe(false);
    await shelf!.getByLabel("打开主窗口").click();
    await expect.poll(() => app.evaluate(({ BrowserWindow }, url) => {
      return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.isVisible();
    }, mainWindow.url())).toBe(true);
    const expandedBeforeDrag = await readShelfBounds();
    await shelf!.evaluate(() => {
      const handle = document.querySelector<HTMLButtonElement>(".shelf-drag-handle");
      if (!handle) throw new Error("展开态拖动把手不存在");
      handle.setPointerCapture = () => {};
      handle.hasPointerCapture = () => false;
      const pointerId = 19;
      const screenX = window.screenX + 14;
      const screenY = window.screenY + 16;
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
        screenX: screenX - 320,
        screenY: screenY + 60,
      }));
    });
    await expect(shelf!.locator(".shelf-shell")).toHaveClass(/is-dragging/);
    await expect(shelf!.locator(".shelf-shell")).toHaveClass(/is-free/);
    await expect.poll(readShelfBounds).toMatchObject({ width: 200 });
    const expandedAfterDrag = await readShelfBounds();
    expect(expandedAfterDrag!.y).toBeGreaterThan(expandedBeforeDrag!.y + 30);
    expect(expandedAfterDrag!.rightGap).toBeGreaterThan(250);
    await shelf!.evaluate(() => {
      const handle = document.querySelector<HTMLButtonElement>(".shelf-drag-handle");
      if (!handle) throw new Error("展开态拖动把手不存在");
      handle.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        isPrimary: true,
        pointerId: 19,
      }));
    });
    await expect(shelf!.locator(".shelf-shell")).not.toHaveClass(/is-dragging/);
    await expect(shelf!.locator(".shelf-shell")).toHaveClass(/is-free/);
    await expect.poll(() => shelf!.evaluate(() => window.innerWidth)).toBe(200);
    await expect(shelf!.locator(".note-list-item")).toHaveCount(1);
    await shelf!.locator(".note-list-item").click();
    await expect.poll(() => readWindowVisible(window.url())).toBe(true);
    const dockedLayout = await readDockedLayout();
    expect(dockedLayout.note).toBeTruthy();
    expect(dockedLayout.shelf).toBeTruthy();
    expect(dockedLayout.area).toBeTruthy();
    const initialLeftGap = dockedLayout.shelf!.x - dockedLayout.note!.x - dockedLayout.note!.width;
    const initialRightGap = dockedLayout.note!.x - dockedLayout.shelf!.x - dockedLayout.shelf!.width;
    expect(Math.max(initialLeftGap, initialRightGap)).toBeGreaterThanOrEqual(10);
    await window.screenshot({ path: "/private/tmp/pinote-docked-note.png" });

    const followDelta = {
      x: dockedLayout.shelf!.x + dockedLayout.shelf!.width / 2 < dockedLayout.area!.x + dockedLayout.area!.width / 2 ? 60 : -60,
      y: dockedLayout.shelf!.y + dockedLayout.shelf!.height / 2 < dockedLayout.area!.y + dockedLayout.area!.height / 2 ? 40 : -40,
    };
    await shelf!.evaluate((delta) => {
      const handle = document.querySelector<HTMLButtonElement>(".shelf-drag-handle");
      if (!handle) throw new Error("展开态拖动把手不存在");
      handle.setPointerCapture = () => {};
      handle.hasPointerCapture = () => false;
      const pointerId = 23;
      const screenX = window.screenX + 14;
      const screenY = window.screenY + 16;
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
        screenX: screenX + delta.x,
        screenY: screenY + delta.y,
      }));
    }, followDelta);
    await expect(shelf!.locator(".shelf-shell")).toHaveClass(/is-dragging/);
    await expect.poll(async () => {
      const layout = await readDockedLayout();
      return {
        noteMoved: Boolean(layout.note && Math.abs(layout.note.x - dockedLayout.note!.x) > 20),
        shelfMoved: Boolean(layout.shelf && Math.abs(layout.shelf.x - dockedLayout.shelf!.x) > 20),
      };
    }).toEqual({ noteMoved: true, shelfMoved: true });
    await shelf!.evaluate(() => {
      const handle = document.querySelector<HTMLButtonElement>(".shelf-drag-handle");
      if (!handle) throw new Error("展开态拖动把手不存在");
      handle.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        isPrimary: true,
        pointerId: 23,
      }));
      window.noteAPI.cancelGroupHide();
    });
    await expect(shelf!.locator(".shelf-shell")).not.toHaveClass(/is-dragging/);
    const followedLayout = await readDockedLayout();
    expect(followedLayout.noteVisible).toBe(true);
    expect(followedLayout.note!.x).toBeGreaterThanOrEqual(followedLayout.area!.x);
    expect(followedLayout.note!.x + followedLayout.note!.width).toBeLessThanOrEqual(followedLayout.area!.x + followedLayout.area!.width);
    expect(followedLayout.shelf!.x).toBeGreaterThanOrEqual(followedLayout.area!.x);
    expect(followedLayout.shelf!.x + followedLayout.shelf!.width).toBeLessThanOrEqual(followedLayout.area!.x + followedLayout.area!.width);
    const followedLeftGap = followedLayout.shelf!.x - followedLayout.note!.x - followedLayout.note!.width;
    const followedRightGap = followedLayout.note!.x - followedLayout.shelf!.x - followedLayout.shelf!.width;
    expect(Math.max(followedLeftGap, followedRightGap)).toBeGreaterThanOrEqual(10);

    await window.evaluate(() => window.noteAPI.hideGroup());
    await window.waitForTimeout(250);
    await expect.poll(() => shelf!.evaluate(() => window.innerWidth)).toBe(200);
    await expect.poll(() => readWindowVisible(window.url())).toBe(true);
    await shelf!.evaluate(() => window.noteAPI.cancelGroupHide());
    await window.waitForTimeout(800);
    await expect.poll(() => shelf!.evaluate(() => window.innerWidth)).toBe(200);
    await expect.poll(() => readWindowVisible(window.url())).toBe(true);

    await shelf!.evaluate(() => window.noteAPI.hideGroup());
    await window.waitForTimeout(250);
    await window.evaluate(() => window.noteAPI.revealGroup());
    await window.waitForTimeout(800);
    await expect.poll(() => shelf!.evaluate(() => window.innerWidth)).toBe(200);
    await expect.poll(() => readWindowVisible(window.url())).toBe(true);

    await moveGroupAwayFromCursor();
    await window.evaluate(() => window.noteAPI.hideGroup());
    await expect.poll(() => shelf!.evaluate(() => window.innerWidth), { timeout: 2_000 }).toBe(36);
    await expect.poll(() => readWindowVisible(window.url())).toBe(false);
    const collapsedAfterExpandedDrag = await readShelfBounds();
    expect(Math.abs(
      collapsedAfterExpandedDrag!.x + collapsedAfterExpandedDrag!.width / 2
      - (followedLayout.shelf!.x + followedLayout.shelf!.width / 2),
    )).toBeLessThanOrEqual(2);
    expect(Math.abs(
      collapsedAfterExpandedDrag!.y + collapsedAfterExpandedDrag!.height / 2
      - (followedLayout.shelf!.y + followedLayout.shelf!.height / 2),
    )).toBeLessThanOrEqual(2);
    await expect(shelf!.getByLabel("展开侧边便签架")).toHaveCSS("width", "32px");
    await expect(shelf!.getByLabel("展开侧边便签架")).not.toHaveCSS("box-shadow", "none");
    await shelf!.screenshot({ path: "/private/tmp/pinote-shelf-free-ball.png" });
    await shelf!.getByLabel("展开侧边便签架").click();
    await expect.poll(() => shelf!.evaluate(() => window.innerWidth), { timeout: 500 }).toBe(200);

    await moveGroupAwayFromCursor();
    await shelf!.evaluate(() => {
      const shell = document.querySelector<HTMLElement>(".shelf-shell");
      const handle = document.querySelector<HTMLButtonElement>(".shelf-drag-handle");
      if (!shell || !handle) throw new Error("展开态拖动区域不存在");
      handle.setPointerCapture = () => {};
      handle.hasPointerCapture = () => false;
      const pointerId = 29;
      handle.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        isPrimary: true,
        pointerId,
        screenX: window.screenX + 14,
        screenY: window.screenY + 16,
      }));
      shell.dispatchEvent(new PointerEvent("pointerout", {
        bubbles: true,
        pointerId,
        relatedTarget: null,
      }));
      handle.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        isPrimary: true,
        pointerId,
      }));
    });
    await expect(shelf!.locator(".shelf-shell")).not.toHaveClass(/is-dragging/);
    await shelf!.waitForTimeout(250);
    expect(await shelf!.evaluate(() => window.innerWidth)).toBe(200);
    await expect.poll(() => shelf!.evaluate(() => window.innerWidth), { timeout: 2_000 }).toBe(36);
    await shelf!.getByLabel("展开侧边便签架").click();
    await expect.poll(() => shelf!.evaluate(() => window.innerWidth), { timeout: 500 }).toBe(200);

    await secondWindow.getByLabel("收纳到侧边").click();
    await expect.poll(() => readNoteDockState(secondWindow, secondNoteId)).toBe("shelf");
    await expect.poll(() => readWindowVisible(secondWindow.url())).toBe(false);
    await shelf!.locator(".shelf-shell").hover({ position: { x: 28, y: 18 } });
    await expect.poll(() => shelf!.evaluate(() => window.innerWidth)).toBe(200);
    await expect(shelf!.locator(".note-list-item")).toHaveCount(2);
    await shelf!.screenshot({ path: "/private/tmp/pinote-shelf.png" });

    const firstShelfItem = shelf!.locator(".note-list-item").filter({ hasText: "QA 便签" });
    await firstShelfItem.evaluate((item) => {
      const row = item as HTMLButtonElement;
      row.setPointerCapture = () => {};
      row.hasPointerCapture = () => false;
      const pointerId = 23;
      const screenX = window.screenX + 90;
      const screenY = window.screenY + 62;
      row.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        isPrimary: true,
        pointerId,
        screenX,
        screenY,
      }));
      row.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        isPrimary: true,
        pointerId,
        screenX: screenX + 160,
        screenY: screenY + 90,
      }));
    });
    await shelf!.waitForTimeout(40);
    const revealState = await app.evaluate(({ BrowserWindow }, url) => {
      const noteWindow = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url);
      return { bounds: noteWindow?.getBounds(), visible: noteWindow?.isVisible(), alwaysOnTop: noteWindow?.isAlwaysOnTop() };
    }, window.url());
    expect(revealState.visible).toBe(true);
    expect(revealState.alwaysOnTop).toBe(true);
    expect(revealState.bounds!.width).toBeLessThan(360);
    expect(await readNoteDockState(window, firstNoteId)).toBe("shelf");
    await firstShelfItem.evaluate((item) => {
      item.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        isPrimary: true,
        pointerId: 23,
      }));
    });
    await expect.poll(() => readNoteDockState(window, firstNoteId)).toBe("free");
    await expect.poll(() => readWindowVisible(window.url())).toBe(true);
    await expect(shelf!.locator(".note-list-item")).toHaveCount(1);
    const draggedOutBounds = await app.evaluate(({ BrowserWindow }, url) => {
      return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.getBounds();
    }, window.url());
    expect(draggedOutBounds).toBeTruthy();

    await shelf!.evaluate(() => window.noteAPI.setShelfExpanded(false));
    await expect.poll(() => shelf!.evaluate(() => window.innerWidth)).toBe(36);
    const collapsedShelfBounds = await readShelfBounds();
    const firstTitleBar = window.locator(".title-bar");
    await firstTitleBar.evaluate((titleBar, target) => {
      const bar = titleBar as HTMLElement;
      bar.setPointerCapture = () => {};
      const pointerId = 29;
      const startX = window.screenX + 80;
      const startY = window.screenY + 8;
      const targetX = target.x + target.width / 2;
      const targetY = target.y + target.height / 2;
      bar.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        isPrimary: true,
        pointerId,
        screenX: startX,
        screenY: startY,
      }));
      bar.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        isPrimary: true,
        pointerId,
        screenX: targetX,
        screenY: targetY,
      }));
    }, collapsedShelfBounds!);
    await window.waitForTimeout(40);
    const previewState = await app.evaluate(({ BrowserWindow }, url) => {
      const noteWindow = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url);
      return { bounds: noteWindow?.getBounds(), visible: noteWindow?.isVisible(), alwaysOnTop: noteWindow?.isAlwaysOnTop() };
    }, window.url());
    expect(await readNoteDockState(window, firstNoteId)).toBe("free");
    expect(previewState.visible).toBe(true);
    expect(previewState.alwaysOnTop).toBe(true);
    expect(previewState.bounds!.width).toBeLessThan(draggedOutBounds!.width);
    await firstTitleBar.evaluate((titleBar) => {
      titleBar.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        isPrimary: true,
        pointerId: 29,
      }));
    });
    await expect.poll(() => readNoteDockState(window, firstNoteId)).toBe("shelf");
    await expect.poll(() => readWindowVisible(window.url())).toBe(false);
    await expect(shelf!.locator(".note-list-item")).toHaveCount(2);
    await window.evaluate((id) => window.noteAPI.toggleNoteDock(id), firstNoteId);
    await expect.poll(() => readNoteDockState(window, firstNoteId)).toBe("free");
    await expect.poll(() => readWindowVisible(window.url())).toBe(true);
    await expect(shelf!.locator(".note-list-item")).toHaveCount(1);
    const firstAfterDetach = await window.evaluate(async (id) => {
      const note = (await window.noteAPI.getNote(id)).note;
      return note ? { revision: note.revision, modifiedAt: note.modifiedAt } : null;
    }, firstNoteId);
    expect(firstAfterDetach).toEqual(firstBeforeDock);

    await shelf!.getByLabel("展开侧边便签架").click();
    await expect.poll(() => shelf!.evaluate(() => window.innerWidth)).toBe(200);
    await shelf!.locator(".note-list-item").click();
    await expect.poll(() => readWindowVisible(secondWindow.url())).toBe(true);
    const dockedSecondClosed = secondWindow.waitForEvent("close");
    await secondWindow.getByLabel("关闭便签").click();
    await dockedSecondClosed;
    await expect(shelf!.locator(".note-list-item")).toHaveCount(1);
    await shelf!.locator(".note-list-item").click();
    await expect.poll(() => app.windows().some((page) => page.url() === secondNoteUrl)).toBe(true);
    secondWindow = app.windows().find((page) => page.url() === secondNoteUrl);
    if (!secondWindow) throw new Error("侧边便签未重新打开");
    await secondWindow.getByLabel("移出侧边").click();
    await expect.poll(() => readNoteDockState(secondWindow, secondNoteId)).toBe("free");
    await expect.poll(() => readWindowVisible(secondWindow.url())).toBe(true);
    await expect.poll(() => app.evaluate(({ BrowserWindow }, url) => {
      return BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url)?.getBounds();
    }, secondWindow.url())).toEqual({
      x: snapFixture.secondX,
      y: snapFixture.secondY,
      width: snapFixture.secondWidth,
      height: snapFixture.secondHeight,
    });
    await expect.poll(() => app.windows().some((page) => page.url().includes("view=shelf"))).toBe(false);

    const firstClosed = window.waitForEvent("close");
    await triggerShortcut(window, "close-window");
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
    await triggerShortcut(mainWindow, "close-window");
    await expect.poll(readMainState).toMatchObject({ visible: false, minimized: false, destroyed: false });
    expect(mainWindow.isClosed()).toBe(false);

    await triggerShortcut(reopenedWindow!, "open-main-window");
    await expect.poll(readMainState).toMatchObject({ visible: true, minimized: false, destroyed: false });
  } finally {
    await app.close();
  }
});

test("主窗口确认退出并保存待写入内容", async () => {
  const userData = `/private/tmp/pinote-quit-e2e-${Date.now()}`;
  const app = await electron.launch({
    args: ["."],
    cwd: path.resolve("."),
    env: { ...process.env, PINOTE_USER_DATA: userData },
  });
  let exited = false;
  try {
    await expect.poll(() => app.windows().some((page) => page.url().includes("view=main"))).toBe(true);
    const mainWindow = app.windows().find((page) => page.url().includes("view=main"));
    if (!mainWindow) throw new Error("主窗口未创建");
    const quitButton = mainWindow.locator(".main-quit-button");
    await expect(quitButton).toBeVisible();
    await expect(quitButton).toHaveCSS("width", "32px");

    await mainWindow.locator(".main-create-button").click();
    await expect.poll(() => app.windows().some((page) => page.url().includes("noteId="))).toBe(true);
    const noteWindow = app.windows().find((page) => page.url().includes("noteId="));
    if (!noteWindow) throw new Error("便签窗口未创建");
    const noteId = new URL(noteWindow.url()).searchParams.get("noteId");
    if (!noteId) throw new Error("便签 id 不存在");
    await noteWindow.locator(".title-input").fill("退出保存验证");
    await noteWindow.locator(".note-editor .cm-content").fill("尚未完成防抖保存的内容");

    await app.evaluate(({ dialog }) => {
      const state = globalThis as typeof globalThis & {
        __pinoteQuitDialogCount?: number;
        __pinoteQuitDialogOwner?: string;
        __pinoteQuitDialogResponse?: number;
      };
      state.__pinoteQuitDialogCount = 0;
      state.__pinoteQuitDialogOwner = "";
      state.__pinoteQuitDialogResponse = 0;
      Object.defineProperty(dialog, "showMessageBox", {
        configurable: true,
        value: async (owner: Electron.BrowserWindow) => {
          state.__pinoteQuitDialogCount = (state.__pinoteQuitDialogCount ?? 0) + 1;
          state.__pinoteQuitDialogOwner = owner.webContents.getURL();
          return { response: state.__pinoteQuitDialogResponse ?? 0, checkboxChecked: false };
        },
      });
    });

    expect(await noteWindow.evaluate(() => window.noteAPI.requestQuit())).toBe(false);
    expect(await app.evaluate(() => (
      globalThis as typeof globalThis & { __pinoteQuitDialogCount?: number }
    ).__pinoteQuitDialogCount)).toBe(0);

    await quitButton.click();
    await expect.poll(() => app.evaluate(() => (
      globalThis as typeof globalThis & { __pinoteQuitDialogCount?: number }
    ).__pinoteQuitDialogCount)).toBe(1);
    expect(await app.evaluate(() => (
      globalThis as typeof globalThis & { __pinoteQuitDialogOwner?: string }
    ).__pinoteQuitDialogOwner)).toContain("view=main");
    const cancelledState = await app.evaluate(({ BrowserWindow }, url) => {
      const main = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url);
      return { visible: main?.isVisible(), destroyed: main?.isDestroyed() };
    }, mainWindow.url());
    expect(cancelledState).toEqual({ visible: true, destroyed: false });
    await expect(quitButton).toBeEnabled();

    await app.evaluate(() => {
      const state = globalThis as typeof globalThis & { __pinoteQuitDialogResponse?: number };
      state.__pinoteQuitDialogResponse = 1;
    });
    const pendingMarkdown = `退出前即时内容 ${Date.now()}`;
    await noteWindow.locator(".note-editor .cm-content").fill(pendingMarkdown);
    const beforeQuit = await noteWindow.evaluate(async (id) => (await window.noteAPI.getNote(id)).note, noteId);
    expect(beforeQuit?.markdown).not.toBe(pendingMarkdown);
    const process = app.process();
    const exitPromise = new Promise<number | null>((resolve) => {
      if (process.exitCode !== null) resolve(process.exitCode);
      else process.once("exit", (code) => resolve(code));
    });
    await quitButton.dispatchEvent("click");
    expect(await exitPromise).toBe(0);
    exited = true;

    const restored = await electron.launch({
      args: ["."],
      cwd: path.resolve("."),
      env: { ...process.env, PINOTE_USER_DATA: userData },
    });
    try {
      await expect.poll(() => restored.windows().some((page) => page.url().includes("view=main"))).toBe(true);
      const restoredMain = restored.windows().find((page) => page.url().includes("view=main"));
      if (!restoredMain) throw new Error("恢复后的主窗口未创建");
      await expect(restoredMain.getByText("退出保存验证")).toBeVisible();
      const restoredNote = await restoredMain.evaluate(async (id) => (await window.noteAPI.getNote(id)).note, noteId);
      expect(restoredNote?.markdown).toBe(pendingMarkdown);
    } finally {
      await restored.close();
    }
  } finally {
    if (!exited) await app.close();
  }
});
