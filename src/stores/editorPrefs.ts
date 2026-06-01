import { create } from 'zustand';

interface EditorPrefsState {
  /** Soft-wrap long lines to the viewport. Default off. */
  wordWrap: boolean;
  /** Show vertical indentation guides. Default on. */
  indentGuides: boolean;
  toggleWordWrap: () => void;
  toggleIndentGuides: () => void;
  setWordWrap: (v: boolean) => void;
  setIndentGuides: (v: boolean) => void;
  reset: () => void;
}

const DEFAULTS = { wordWrap: false, indentGuides: true };

export const useEditorPrefs = create<EditorPrefsState>((set) => ({
  ...DEFAULTS,
  toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
  toggleIndentGuides: () => set((s) => ({ indentGuides: !s.indentGuides })),
  setWordWrap: (v) => set({ wordWrap: v }),
  setIndentGuides: (v) => set({ indentGuides: v }),
  reset: () => set({ ...DEFAULTS }),
}));
