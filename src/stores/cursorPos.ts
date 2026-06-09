import { create } from 'zustand';

interface CursorPosState {
  line: number; // 1-based
  col: number;  // 1-based
  cursorCount: number; // number of active selection ranges (>=1)
  set: (line: number, col: number, cursorCount?: number) => void;
  reset: () => void;
}

export const useCursorPos = create<CursorPosState>((set) => ({
  line: 1,
  col: 1,
  cursorCount: 1,
  set: (line, col, cursorCount = 1) => set({ line, col, cursorCount }),
  reset: () => set({ line: 1, col: 1, cursorCount: 1 }),
}));
