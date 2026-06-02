import { create } from 'zustand';

interface EditorPrefsState {
  /** Soft-wrap long lines to the viewport. Default off. */
  wordWrap: boolean;
  /** Show vertical indentation guides. Default on. */
  indentGuides: boolean;
  /** Show the code-overview minimap. Default off. */
  minimap: boolean;
  toggleMinimap: () => void;
  setMinimap: (v: boolean) => void;
  toggleWordWrap: () => void;
  toggleIndentGuides: () => void;
  setWordWrap: (v: boolean) => void;
  setIndentGuides: (v: boolean) => void;
  reset: () => void;
}

const DEFAULTS = { wordWrap: false, indentGuides: true, minimap: false };

export const useEditorPrefs = create<EditorPrefsState>((set) => ({
  ...DEFAULTS,
  toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
  toggleIndentGuides: () => set((s) => ({ indentGuides: !s.indentGuides })),
  toggleMinimap: () => set((s) => ({ minimap: !s.minimap })),
  setMinimap: (v) => set({ minimap: v }),
  setWordWrap: (v) => set({ wordWrap: v }),
  setIndentGuides: (v) => set({ indentGuides: v }),
  reset: () => set({ ...DEFAULTS }),
}));
