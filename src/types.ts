export interface Note {
  id: string;
  title: string;
  markdown: string;
  color: string;
  groupName: string;
  tags: string[];
  archivedAt: number | null;
  revision: number;
  modifiedAt: number;
  modifiedBy: string;
  dirty: boolean;
  collapsed: boolean;
  pinned: boolean;
  open: boolean;
  dockState: DockState;
}

export interface NoteSummary {
  id: string;
  title: string;
  markdown: string;
  color: string;
  groupName: string;
  tags: string[];
  archivedAt: number | null;
  modifiedAt: number;
  open: boolean;
  pinned: boolean;
  dockState: DockState;
}

export type DockState = "free" | "shelf" | "inline";
export type ShelfPlacementEdge = "left" | "right" | "free";

export type NoteResizeEdge = "n" | "s" | "e" | "w" | "nw" | "sw" | "se";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WindowSize = Pick<WindowBounds, "width" | "height">;

export interface GroupState {
  mode: "shelf" | "inline";
  activeId: string | null;
  dockedIds: string[];
}

export interface DockToggleResult {
  note: Note | null;
  group: GroupState;
}

export interface PlatformCapabilities {
  platform: "darwin" | "win32" | "linux";
  wayland: boolean;
}

export type AppCommand =
  | "close-window"
  | "focus-search"
  | "open-settings"
  | "focus-title"
  | "focus-editor"
  | "toggle-collapse"
  | "toggle-pin"
  | "toggle-dock"
  | "toggle-color-picker"
  | "toggle-metadata"
  | "toggle-archive";

export type ShortcutCommandId =
  | "open-main-window"
  | "new-note"
  | "focus-search"
  | "open-settings"
  | "sync-now"
  | "close-window"
  | "focus-title"
  | "focus-editor"
  | "toggle-collapse"
  | "toggle-pin"
  | "toggle-dock"
  | "toggle-color-picker"
  | "toggle-metadata"
  | "toggle-archive";

export interface GeneralSettings {
  launchAtLogin: boolean;
  launchAtLoginSupported: boolean;
  showMainOnLogin: boolean;
  closeMainToTray: boolean;
  hideDockOnMainClose: boolean;
  hideDockOnMainCloseSupported: boolean;
  defaultNoteColor: string;
  defaultNotePinned: boolean;
}

export interface ShortcutSetting {
  id: ShortcutCommandId;
  label: string;
  group: "main" | "window" | "note";
  globalEligible: boolean;
  accelerator: string | null;
  global: boolean;
}

export interface AppSettings {
  general: GeneralSettings;
  shortcuts: ShortcutSetting[];
}

export interface AppInfo {
  name: string;
  version: string;
  electronVersion: string;
  platform: string;
  arch: string;
}

export interface NoteAPI {
  getNote: (id: string) => Promise<{ note: Note | null; group: GroupState; capabilities: PlatformCapabilities }>;
  updateNote: (
    id: string,
    patch: Pick<Partial<Note>, "title" | "markdown" | "color" | "groupName" | "tags">,
    baseRevision?: number,
  ) => Promise<Note | null>;
  createNote: () => Promise<Note>;
  closeNote: (id: string) => Promise<boolean>;
  openNote: (id: string) => Promise<Note | null>;
  deleteNote: (id: string) => Promise<void>;
  setNoteArchived: (id: string, archived: boolean) => Promise<Note | null>;
  openMainWindow: () => Promise<boolean>;
  requestQuit: () => Promise<boolean>;
  toggleCollapse: (id: string) => Promise<void>;
  beginWindowMove: (id: string) => void;
  moveWindow: (id: string, x: number, y: number, pointerX: number, pointerY: number) => void;
  endWindowMove: (id: string) => void;
  enableWindowFocus: (id: string) => void;
  beginWindowResize: (id: string) => void;
  resizeWindow: (id: string, edge: NoteResizeEdge, size: WindowSize) => void;
  endWindowResize: (id: string) => void;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  toggleNoteDock: (id: string) => Promise<DockToggleResult>;
  revealGroup: () => void;
  hideGroup: () => void;
  cancelGroupHide: () => void;
  listNotes: () => Promise<NoteSummary[]>;
  activateDockedNote: (id: string) => Promise<void>;
  closeDockedNote: (id: string) => Promise<boolean>;
  setShelfExpanded: (expanded: boolean) => void;
  beginShelfMove: () => void;
  moveShelf: (deltaX: number, deltaY: number) => void;
  endShelfMove: () => void;
  beginShelfNoteDrag: (id: string, pointerX: number, pointerY: number, sourceBounds: WindowBounds) => void;
  moveShelfNoteDrag: (id: string, pointerX: number, pointerY: number, dropBounds: WindowBounds | null) => void;
  endShelfNoteDrag: (id: string) => void;
  getSyncSettings: () => Promise<SyncSettings>;
  getSyncStatus: () => Promise<SyncStatus>;
  configureSync: (settings: { url: string; token: string }) => Promise<SyncSettings>;
  syncNow: () => Promise<SyncStatus>;
  getAppSettings: () => Promise<AppSettings>;
  updateGeneralSettings: (
    patch: Partial<Omit<GeneralSettings, "launchAtLoginSupported" | "hideDockOnMainCloseSupported">>,
  ) => Promise<AppSettings>;
  updateShortcut: (
    id: ShortcutCommandId,
    patch: { accelerator?: string | null; global?: boolean },
  ) => Promise<AppSettings>;
  resetShortcut: (id: ShortcutCommandId) => Promise<AppSettings>;
  resetShortcuts: () => Promise<AppSettings>;
  getAppInfo: () => Promise<AppInfo>;
  onCollapsed: (callback: (collapsed: boolean) => void) => () => void;
  onGroupState: (callback: (state: GroupState) => void) => () => void;
  onCommand: (callback: (command: AppCommand) => void) => () => void;
  onRemoteNote: (callback: (note: Note) => void) => () => void;
  onFlushRequested: (callback: () => Promise<void>) => () => void;
  onSyncStatus: (callback: (status: SyncStatus) => void) => () => void;
  onAppSettings: (callback: (settings: AppSettings) => void) => () => void;
  onNoteList: (callback: (notes: NoteSummary[]) => void) => () => void;
  onShelfExpanded: (callback: (expanded: boolean) => void) => () => void;
  onShelfPlacement: (callback: (edge: ShelfPlacementEdge) => void) => () => void;
}

export interface SyncSettings {
  url: string;
  configured: boolean;
  tokenPersistent: boolean;
}

export interface SyncStatus {
  state: "idle" | "syncing" | "synced" | "error";
  message: string;
  syncedAt?: number;
}

declare global {
  interface Window {
    noteAPI: NoteAPI;
  }
}
