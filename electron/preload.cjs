const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("noteAPI", {
  getNote: (id) => ipcRenderer.invoke("note:get", id),
  updateNote: (id, patch, baseRevision) => ipcRenderer.invoke("note:update", id, patch, baseRevision),
  createNote: () => ipcRenderer.invoke("note:create"),
  createDockedNote: () => ipcRenderer.invoke("note:create-docked"),
  openNote: (id) => ipcRenderer.invoke("note:open", id),
  closeNote: (id) => ipcRenderer.invoke("note:close", id),
  deleteNote: (id) => ipcRenderer.invoke("note:delete", id),
  setNoteArchived: (id, archived) => ipcRenderer.invoke("note:set-archived", id, archived),
  openMainWindow: () => ipcRenderer.invoke("window:open-main"),
  requestQuit: () => ipcRenderer.invoke("app:request-quit"),
  toggleCollapse: (id) => ipcRenderer.invoke("window:toggle-collapse", id),
  beginWindowMove: (id) => ipcRenderer.send("window:move-start", id),
  moveWindow: (id, x, y, pointerX, pointerY) => ipcRenderer.send("window:move", id, x, y, pointerX, pointerY),
  endWindowMove: (id) => ipcRenderer.send("window:move-end", id),
  enableWindowFocus: (id) => ipcRenderer.send("window:enable-focus", id),
  beginWindowResize: (id) => ipcRenderer.send("window:resize-start", id),
  resizeWindow: (id, edge, bounds) => ipcRenderer.send("window:resize", id, edge, {
    width: bounds?.width,
    height: bounds?.height,
  }),
  endWindowResize: (id) => ipcRenderer.send("window:resize-end", id),
  setPinned: (id, pinned) => ipcRenderer.invoke("window:set-pinned", id, pinned),
  toggleNoteDock: (id) => ipcRenderer.invoke("group:toggle-note-dock", id),
  revealGroup: () => ipcRenderer.send("group:reveal"),
  hideGroup: () => ipcRenderer.send("group:hide"),
  cancelGroupHide: () => ipcRenderer.send("group:cancel-hide"),
  listNotes: (includeDrafts = false) => ipcRenderer.invoke("notes:list", includeDrafts),
  activateDockedNote: (id) => ipcRenderer.invoke("group:activate-note", id),
  closeDockedNote: (id) => ipcRenderer.invoke("group:close-docked-note", id),
  setShelfExpanded: (expanded) => ipcRenderer.send("shelf:set-expanded", expanded),
  beginShelfMove: () => ipcRenderer.send("shelf:move-start"),
  moveShelf: (deltaX, deltaY) => ipcRenderer.send("shelf:move", deltaX, deltaY),
  endShelfMove: () => ipcRenderer.send("shelf:move-end"),
  beginShelfNoteDrag: (id, pointerX, pointerY, sourceBounds) => ipcRenderer.send("shelf:note-drag-start", id, pointerX, pointerY, sourceBounds),
  moveShelfNoteDrag: (id, pointerX, pointerY, dropBounds) => ipcRenderer.send("shelf:note-drag", id, pointerX, pointerY, dropBounds),
  endShelfNoteDrag: (id) => ipcRenderer.send("shelf:note-drag-end", id),
  getSyncSettings: () => ipcRenderer.invoke("sync:get-settings"),
  getSyncStatus: () => ipcRenderer.invoke("sync:get-status"),
  configureSync: (settings) => ipcRenderer.invoke("sync:configure", settings),
  syncNow: () => ipcRenderer.invoke("sync:now"),
  getAppSettings: () => ipcRenderer.invoke("settings:get"),
  updateGeneralSettings: (patch) => ipcRenderer.invoke("settings:update-general", patch),
  updateShortcut: (id, patch) => ipcRenderer.invoke("settings:update-shortcut", id, patch),
  resetShortcut: (id) => ipcRenderer.invoke("settings:reset-shortcut", id),
  resetShortcuts: () => ipcRenderer.invoke("settings:reset-shortcuts"),
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  onCollapsed: (callback) => {
    const listener = (_event, collapsed) => callback(collapsed);
    ipcRenderer.on("note:collapsed", listener);
    return () => ipcRenderer.removeListener("note:collapsed", listener);
  },
  onGroupState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("group:state", listener);
    return () => ipcRenderer.removeListener("group:state", listener);
  },
  onCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("app:command", listener);
    return () => ipcRenderer.removeListener("app:command", listener);
  },
  onRemoteNote: (callback) => {
    const listener = (_event, note) => callback(note);
    ipcRenderer.on("note:remote", listener);
    return () => ipcRenderer.removeListener("note:remote", listener);
  },
  onFlushRequested: (callback) => {
    const listener = async (_event, requestId) => {
      let succeeded = false;
      try {
        await callback();
        succeeded = true;
      } catch {
        succeeded = false;
      }
      ipcRenderer.send("note:flush-complete", requestId, succeeded);
    };
    ipcRenderer.on("note:flush-request", listener);
    return () => ipcRenderer.removeListener("note:flush-request", listener);
  },
  onSyncStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("sync:status", listener);
    return () => ipcRenderer.removeListener("sync:status", listener);
  },
  onAppSettings: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on("settings:changed", listener);
    return () => ipcRenderer.removeListener("settings:changed", listener);
  },
  onNoteList: (callback) => {
    const listener = (_event, notes) => callback(notes);
    ipcRenderer.on("notes:list", listener);
    return () => ipcRenderer.removeListener("notes:list", listener);
  },
  onShelfExpanded: (callback) => {
    const listener = (_event, expanded) => callback(expanded);
    ipcRenderer.on("shelf:expanded", listener);
    return () => ipcRenderer.removeListener("shelf:expanded", listener);
  },
  onShelfPlacement: (callback) => {
    const listener = (_event, edge) => callback(edge);
    ipcRenderer.on("shelf:placement", listener);
    return () => ipcRenderer.removeListener("shelf:placement", listener);
  },
});
