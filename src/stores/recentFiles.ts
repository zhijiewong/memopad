import { create } from 'zustand';

const CAP = 15;
const normalize = (p: string) => p.toLowerCase().replace(/\\/g, '/');

interface RecentFilesState {
  recentFiles: string[];
  push: (path: string) => void;
  setRecent: (list: string[]) => void;
  remove: (path: string) => void;
  clear: () => void;
}

export const useRecentFiles = create<RecentFilesState>((set, get) => ({
  recentFiles: [],
  push: (path) => {
    const norm = normalize(path);
    const filtered = get().recentFiles.filter((p) => normalize(p) !== norm);
    set({ recentFiles: [path, ...filtered].slice(0, CAP) });
  },
  setRecent: (list) => set({ recentFiles: list.slice(0, CAP) }),
  remove: (path) => {
    const norm = normalize(path);
    set({ recentFiles: get().recentFiles.filter((p) => normalize(p) !== norm) });
  },
  clear: () => set({ recentFiles: [] }),
}));
