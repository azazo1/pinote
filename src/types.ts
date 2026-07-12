export interface Note {
  id: string;
  title: string;
  markdown: string;
  color: string;
  groupName: string;
  tags: string[];
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
  modifiedAt: number;
  open: boolean;
  pinned: boolean;
  dockState: DockState;
}

export type DockState = "free" | "shelf" | "inline";

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
  openMainWindow: () => Promise<boolean>;
  toggleCollapse: (id: string) => Promise<void>;
  moveWindow: (id: string, x: number, y: number) => void;
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
  setShelfExpanded: (expanded: boolean) => void;
  moveShelf: (screenY: number) => void;
  getSyncSettings: () => Promise<SyncSettings>;
  getSyncStatus: () => Promise<SyncStatus>;
  configureSync: (settings: { url: string; token: string }) => Promise<SyncSettings>;
  syncNow: () => Promise<SyncStatus>;
  onCollapsed: (callback: (collapsed: boolean) => void) => () => void;
  onGroupState: (callback: (state: GroupState) => void) => () => void;
  onCommand: (callback: (command: string) => void) => () => void;
  onRemoteNote: (callback: (note: Note) => void) => () => void;
  onFlushRequested: (callback: () => Promise<void>) => () => void;
  onSyncStatus: (callback: (status: SyncStatus) => void) => () => void;
  onNoteList: (callback: (notes: NoteSummary[]) => void) => () => void;
  onShelfExpanded: (callback: (expanded: boolean) => void) => () => void;
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
