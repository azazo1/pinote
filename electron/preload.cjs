const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("noteAPI", {
  getNote: (id) => ipcRenderer.invoke("note:get", id),
  updateNote: (id, patch) => ipcRenderer.invoke("note:update", id, patch),
  createNote: () => ipcRenderer.invoke("note:create"),
  openNote: (id) => ipcRenderer.invoke("note:open", id),
  closeNote: (id) => ipcRenderer.invoke("note:close", id),
  deleteNote: (id) => ipcRenderer.invoke("note:delete", id),
  openMainWindow: () => ipcRenderer.invoke("window:open-main"),
  toggleCollapse: (id) => ipcRenderer.invoke("window:toggle-collapse", id),
  moveWindow: (id, x, y) => ipcRenderer.send("window:move", id, x, y),
  setPinned: (id, pinned) => ipcRenderer.invoke("window:set-pinned", id, pinned),
  toggleGroupDock: () => ipcRenderer.invoke("group:toggle-dock"),
  revealGroup: () => ipcRenderer.send("group:reveal"),
  hideGroup: () => ipcRenderer.send("group:hide"),
  listNotes: () => ipcRenderer.invoke("notes:list"),
  activateDockedNote: (id) => ipcRenderer.invoke("group:activate-note", id),
  setShelfExpanded: (expanded) => ipcRenderer.send("shelf:set-expanded", expanded),
  moveShelf: (screenY) => ipcRenderer.send("shelf:move", screenY),
  getSyncSettings: () => ipcRenderer.invoke("sync:get-settings"),
  getSyncStatus: () => ipcRenderer.invoke("sync:get-status"),
  configureSync: (settings) => ipcRenderer.invoke("sync:configure", settings),
  syncNow: () => ipcRenderer.invoke("sync:now"),
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
  onSyncStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("sync:status", listener);
    return () => ipcRenderer.removeListener("sync:status", listener);
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
});
