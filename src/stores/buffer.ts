import { create } from 'zustand';

export type Encoding = 'utf-8' | 'utf-8-bom' | 'utf-16-le' | 'utf-16-be';
export type LineEnding = 'lf' | 'crlf' | 'cr';

export interface OpenedFile {
  path: string;
  content: string;
  encoding: Encoding;
  eol: LineEnding;
}

interface BufferState {
  path: string | null;
  content: string;
  originalContent: string;
  encoding: Encoding;
  eol: LineEnding;
  dirty: boolean;
  setContent: (next: string) => void;
  loadOpened: (file: OpenedFile) => void;
  markSaved: (newPath: string) => void;
  reset: () => void;
}

const INITIAL = {
  path: null as string | null,
  content: '',
  originalContent: '',
  encoding: 'utf-8' as Encoding,
  eol: 'lf' as LineEnding,
  dirty: false,
};

export const useBuffer = create<BufferState>((set) => ({
  ...INITIAL,
  setContent: (next) =>
    set((state) => ({
      content: next,
      dirty: next !== state.originalContent,
    })),
  loadOpened: (file) =>
    set({
      path: file.path,
      content: file.content,
      originalContent: file.content,
      encoding: file.encoding,
      eol: file.eol,
      dirty: false,
    }),
  markSaved: (newPath) =>
    set((state) => ({
      path: newPath,
      originalContent: state.content,
      dirty: false,
    })),
  reset: () => set({ ...INITIAL }),
}));
