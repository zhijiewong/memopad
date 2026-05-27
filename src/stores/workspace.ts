import { create } from 'zustand';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { findInFolder, type FindOptions, type FindResponse } from '../lib/tauri';

interface WorkspaceState {
  workspaceFolder: string | null;
  results: FindResponse | null;
  inFlight: boolean;
  lastQuery: string;
  lastOpts: FindOptions;
  /** Monotonic counter to drop stale search responses. */
  requestId: number;

  openFolder: () => Promise<void>;
  closeFolder: () => void;
  runSearch: (query: string, opts: FindOptions) => Promise<void>;
  clearResults: () => void;
  setFolder: (folder: string | null) => void;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  workspaceFolder: null,
  results: null,
  inFlight: false,
  lastQuery: '',
  lastOpts: { regex: false, case_sensitive: false, whole_word: false },
  requestId: 0,

  async openFolder() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === 'string') {
      set({ workspaceFolder: picked, results: null });
    }
  },

  closeFolder() {
    set({ workspaceFolder: null, results: null, inFlight: false });
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

  clearResults() { set({ results: null }); },
  setFolder(folder) { set({ workspaceFolder: folder }); },
}));
