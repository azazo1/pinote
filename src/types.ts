export interface Note {
  id: string;
  title: string;
  markdown: string;
  color: string;
  revision: number;
  modifiedAt: number;
  modifiedBy: string;
  dirty: boolean;
  collapsed: boolean;
  pinned: boolean;
}

export interface NoteSummary {
  id: string;
  title: string;
  color: string;
  modifiedAt: number;
}

export interface GroupState {
  docked: boolean;
  mode: "shelf" | "inline";
  activeId?: string | null;
}

export interface PlatformCapabilities {
  platform: "darwin" | "win32" | "linux";
  wayland: boolean;
}

export interface NoteAPI {
  getNote: (id: string) => Promise<{ note: Note | null; group: GroupState; capabilities: PlatformCapabilities }>;
  updateNote: (id: string, patch: Pick<Partial<Note>, "title" | "markdown" | "color">) => Promise<Note | null>;
  createNote: () => Promise<Note>;
  deleteNote: (id: string) => Promise<void>;
  toggleCollapse: (id: string) => Promise<void>;
  moveWindow: (id: string, x: number, y: number) => void;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  toggleGroupDock: () => Promise<GroupState>;
  revealGroup: () => void;
  hideGroup: () => void;
  listNotes: () => Promise<NoteSummary[]>;
  activateDockedNote: (id: string) => Promise<void>;
  setShelfExpanded: (expanded: boolean) => void;
  getSyncSettings: () => Promise<SyncSettings>;
  getSyncStatus: () => Promise<SyncStatus>;
  configureSync: (settings: { url: string; token: string }) => Promise<SyncSettings>;
  syncNow: () => Promise<SyncStatus>;
  onCollapsed: (callback: (collapsed: boolean) => void) => () => void;
  onGroupState: (callback: (state: GroupState) => void) => () => void;
  onCommand: (callback: (command: string) => void) => () => void;
  onRemoteNote: (callback: (note: Note) => void) => () => void;
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
