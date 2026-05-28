import { create } from 'zustand';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { findInFolder, listDir, type FindOptions, type FindResponse, type DirEntry } from '../lib/tauri';

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

  openFolder: () => Promise<void>;
  closeFolder: () => void;
  runSearch: (query: string, opts: FindOptions) => Promise<void>;
  clearResults: () => void;
  setFolder: (folder: string | null) => void;
  toggleExpand: (path: string) => Promise<void>;
  refreshSubtree: (path: string) => Promise<void>;
  clearTreeCache: () => void;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  workspaceFolder: null,
  results: null,
  inFlight: false,
  lastQuery: '',
  lastOpts: { regex: false, case_sensitive: false, whole_word: false },
  requestId: 0,
  expanded: new Set<string>(),
  childrenByPath: new Map<string, DirEntry[]>(),
  loadingByPath: new Set<string>(),

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

  clearTreeCache() {
    set({
      expanded: new Set<string>(),
      childrenByPath: new Map<string, DirEntry[]>(),
      loadingByPath: new Set<string>(),
    });
  },

  clearResults() { set({ results: null }); },
  setFolder(folder) { set({ workspaceFolder: folder }); },
}));
