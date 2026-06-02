import { create } from 'zustand';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { findInFolder, listDir, replaceInFiles as replaceInFilesIpc, type FindOptions, type FindResponse, type DirEntry, type ReplaceResponse } from '../lib/tauri';

interface WorkspaceState {
  workspaceFolder: string | null;
  results: FindResponse | null;
  inFlight: boolean;
  lastQuery: string;
  lastOpts: FindOptions;
  /** Monotonic counter to drop stale search responses. */
  requestId: number;

  expanded: Set<string>;
  childrenByPath: Map<string, DirEntry[]>;
  loadingByPath: Set<string>;

  replaceInFlight: boolean;

  recentFolders: string[];

  watcherError: string | null;
  setWatcherError: (msg: string | null) => void;

  pushRecentFolder: (path: string) => void;
  removeRecentFolder: (path: string) => void;
  setRecent: (list: string[]) => void;

  openFolder: () => Promise<void>;
  closeFolder: () => void;
  runSearch: (query: string, opts: FindOptions) => Promise<void>;
  clearResults: () => void;
  setFolder: (folder: string | null) => void;
  toggleExpand: (path: string) => Promise<void>;
  refreshSubtree: (path: string) => Promise<void>;
  replaceInFiles: (replacement: string) => Promise<ReplaceResponse>;
  clearTreeCache: () => void;
  createEntry: (parentPath: string, name: string, isDir: boolean) => Promise<DirEntry>;
  renameEntry: (path: string, newName: string) => Promise<string>;
  deleteEntry: (path: string) => Promise<void>;

  dragPath: string | null;
  setDragPath: (p: string | null) => void;
  moveError: string | null;
  setMoveError: (m: string | null) => void;
  moveEntry: (srcPath: string, destDir: string) => Promise<string>;

  editState: TreeEditState;
  setEditState: (e: TreeEditState) => void;
  pendingDelete: DirEntry | null;
  setPendingDelete: (e: DirEntry | null) => void;
}

export type TreeEditState =
  | { mode: 'rename'; path: string }
  | { mode: 'create'; parent: string; isDir: boolean }
  | null;

/** The parent directory of an absolute path (handles both separators). */
function parentOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx <= 0 ? p : p.slice(0, idx);
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  workspaceFolder: null,
  results: null,
  inFlight: false,
  replaceInFlight: false,
  lastQuery: '',
  lastOpts: { regex: false, case_sensitive: false, whole_word: false },
  requestId: 0,
  expanded: new Set<string>(),
  childrenByPath: new Map<string, DirEntry[]>(),
  loadingByPath: new Set<string>(),
  recentFolders: [],
  watcherError: null,
  editState: null,
  pendingDelete: null,
  dragPath: null,
  moveError: null,

  setEditState(e) { set({ editState: e }); },
  setPendingDelete(e) { set({ pendingDelete: e }); },

  setWatcherError(msg) {
    set({ watcherError: msg });
  },

  async openFolder() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === 'string') {
      set({
        workspaceFolder: picked,
        results: null,
        expanded: new Set<string>(),
        childrenByPath: new Map<string, DirEntry[]>(),
        loadingByPath: new Set<string>(),
      });
      get().pushRecentFolder(picked);
    }
  },

  closeFolder() {
    set({
      workspaceFolder: null,
      results: null,
      inFlight: false,
      expanded: new Set<string>(),
      childrenByPath: new Map<string, DirEntry[]>(),
      loadingByPath: new Set<string>(),
    });
  },

  async runSearch(query, opts) {
    const folder = get().workspaceFolder;
    if (!folder) return;
    if (query.trim() === '') { set({ results: null, lastQuery: query, lastOpts: opts }); return; }

    const id = get().requestId + 1;
    set({ requestId: id, inFlight: true, lastQuery: query, lastOpts: opts });
    try {
      const resp = await findInFolder(folder, query, opts);
      if (get().requestId !== id) return;
      set({ results: resp, inFlight: false });
    } catch (err) {
      if (get().requestId !== id) return;
      set({ results: { files: [], truncated: false, elapsed_ms: 0, error: (err as Error).message }, inFlight: false });
    }
  },

  async toggleExpand(path) {
    const cur = get();
    if (cur.expanded.has(path)) {
      const next = new Set(cur.expanded);
      next.delete(path);
      set({ expanded: next });
      return;
    }
    const nextExpanded = new Set(cur.expanded);
    nextExpanded.add(path);
    set({ expanded: nextExpanded });
    if (cur.childrenByPath.has(path)) return;
    const folder = cur.workspaceFolder;
    if (!folder) return;
    const nextLoading = new Set(cur.loadingByPath);
    nextLoading.add(path);
    set({ loadingByPath: nextLoading });
    try {
      const kids = await listDir(folder, path);
      const c = get();
      const newChildren = new Map(c.childrenByPath);
      newChildren.set(path, kids);
      const newLoading = new Set(c.loadingByPath);
      newLoading.delete(path);
      set({ childrenByPath: newChildren, loadingByPath: newLoading });
    } catch {
      const c = get();
      const newLoading = new Set(c.loadingByPath);
      newLoading.delete(path);
      set({ loadingByPath: newLoading });
    }
  },

  async refreshSubtree(path) {
    const folder = get().workspaceFolder;
    if (!folder) return;
    const nextLoading = new Set(get().loadingByPath);
    nextLoading.add(path);
    set({ loadingByPath: nextLoading });
    try {
      const kids = await listDir(folder, path);
      const c = get();
      const newChildren = new Map(c.childrenByPath);
      newChildren.set(path, kids);
      const newLoading = new Set(c.loadingByPath);
      newLoading.delete(path);
      set({ childrenByPath: newChildren, loadingByPath: newLoading });
    } catch {
      const c = get();
      const newLoading = new Set(c.loadingByPath);
      newLoading.delete(path);
      set({ loadingByPath: newLoading });
    }
  },

  async replaceInFiles(replacement) {
    const cur = get();
    if (!cur.workspaceFolder) {
      return { results: [], total_files_replaced: 0, total_matches_replaced: 0 };
    }
    if (!cur.results || cur.results.files.length === 0) {
      return { results: [], total_files_replaced: 0, total_matches_replaced: 0 };
    }
    if (cur.lastQuery.trim() === '') {
      return { results: [], total_files_replaced: 0, total_matches_replaced: 0 };
    }

    const targetPaths = cur.results.files.map((f) => f.path);
    set({ replaceInFlight: true });
    let resp: ReplaceResponse;
    try {
      resp = await replaceInFilesIpc(
        cur.workspaceFolder, cur.lastQuery, replacement, cur.lastOpts, targetPaths,
      );
    } finally {
      set({ replaceInFlight: false });
    }

    await get().runSearch(cur.lastQuery, cur.lastOpts);

    const { useBuffers } = await import('./buffers');
    for (const r of resp.results) {
      if (r.error == null && r.matches_replaced > 0) {
        await useBuffers.getState().reloadIfOpen(r.path);
      }
    }

    return resp;
  },

  async createEntry(parentPath, name, isDir) {
    const folder = get().workspaceFolder;
    if (!folder) throw new Error('No workspace open');
    const { createFile, createDir } = await import('../lib/tauri');
    const entry = isDir
      ? await createDir(folder, parentPath, name)
      : await createFile(folder, parentPath, name);
    if (!get().expanded.has(parentPath)) {
      const next = new Set(get().expanded);
      next.add(parentPath);
      set({ expanded: next });
    }
    await get().refreshSubtree(parentPath);
    return entry;
  },

  async renameEntry(path, newName) {
    const folder = get().workspaceFolder;
    if (!folder) throw new Error('No workspace open');
    const { renamePath } = await import('../lib/tauri');
    const newPath = await renamePath(folder, path, newName);
    await get().refreshSubtree(parentOf(path));
    const { useBuffers } = await import('./buffers');
    useBuffers.getState().renamePath(path, newPath);
    return newPath;
  },

  async deleteEntry(path) {
    const folder = get().workspaceFolder;
    if (!folder) throw new Error('No workspace open');
    const { deletePath } = await import('../lib/tauri');
    await deletePath(folder, path);
    const { useBuffers } = await import('./buffers');
    useBuffers.getState().handleDeletedPath(path);
    await get().refreshSubtree(parentOf(path));
  },

  setDragPath(p) { set({ dragPath: p }); },
  setMoveError(m) { set({ moveError: m }); },

  async moveEntry(srcPath, destDir) {
    const folder = get().workspaceFolder;
    if (!folder) throw new Error('No workspace open');
    const { movePath } = await import('../lib/tauri');
    const newPath = await movePath(folder, srcPath, destDir);
    await get().refreshSubtree(parentOf(srcPath));
    await get().refreshSubtree(destDir);
    const { useBuffers } = await import('./buffers');
    useBuffers.getState().renamePath(srcPath, newPath);
    return newPath;
  },

  clearTreeCache() {
    set({
      expanded: new Set<string>(),
      childrenByPath: new Map<string, DirEntry[]>(),
      loadingByPath: new Set<string>(),
    });
  },

  clearResults() { set({ results: null }); },
  setFolder(folder) { set({ workspaceFolder: folder }); },

  pushRecentFolder(path) {
    const normalize = (p: string) => p.toLowerCase().replace(/\\/g, '/');
    const cur = get().recentFolders;
    const norm = normalize(path);
    const filtered = cur.filter((p) => normalize(p) !== norm);
    const next = [path, ...filtered].slice(0, 10);
    set({ recentFolders: next });
  },

  removeRecentFolder(path) {
    const normalize = (p: string) => p.toLowerCase().replace(/\\/g, '/');
    const norm = normalize(path);
    set({ recentFolders: get().recentFolders.filter((p) => normalize(p) !== norm) });
  },

  setRecent(list) {
    set({ recentFolders: list.slice(0, 10) });
  },
}));
