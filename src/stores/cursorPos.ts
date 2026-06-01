import { create } from 'zustand';

interface CursorPosState {
  line: number; // 1-based
  col: number;  // 1-based
  set: (line: number, col: number) => void;
  reset: () => void;
}

export const useCursorPos = create<CursorPosState>((set) => ({
  line: 1,
  col: 1,
  set: (line, col) => set({ line, col }),
  reset: () => set({ line: 1, col: 1 }),
}));
