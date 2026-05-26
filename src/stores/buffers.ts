import { create } from 'zustand';

export type Encoding = 'utf-8' | 'utf-8-bom' | 'utf-16-le' | 'utf-16-be';
export type LineEnding = 'lf' | 'crlf' | 'cr';

export interface OpenedFile {
  path: string;
  content: string;
  encoding: Encoding;
  eol: LineEnding;
}

export interface FileStatSnapshot {
  mtime_ms: number;
  size: number;
}

export interface Buffer {
  id: string;
  path: string | null;
  content: string;
  originalContent: string;
  encoding: Encoding;
  eol: LineEnding;
  dirty: boolean;
  recordedStat: FileStatSnapshot | null;
  externalChange: boolean;
}

export interface RestoredBufferInput {
  bufferId: string;
  path: string | null;
  content: string;
  encoding: Encoding;
  eol: LineEnding;
  dirty: boolean;
}

export interface ReplaceBufferInput {
  path: string | null;
  content: string;
  encoding: Encoding;
  eol: LineEnding;
}

interface BuffersState {
  buffers: Buffer[];
  activeId: string | null;
  recentlyClosed: Buffer[];

  newBuffer: () => string;
  openBuffer: (file: OpenedFile) => string;
  openRestored: (input: RestoredBufferInput) => string;
  closeBuffer: (id: string) => void;
  switchTo: (id: string) => void;
  setActiveContent: (next: string) => void;
  markSaved: (id: string, newPath: string) => void;
  setActiveEncoding: (enc: Encoding) => void;
  setActiveEol: (eol: LineEnding) => void;
  reorderBuffer: (id: string, toIndex: number) => void;
  reopenLastClosed: () => string | null;
  recordStat: (id: string, stat: FileStatSnapshot) => void;
  setExternalChange: (id: string, flag: boolean) => void;
  replaceBuffer: (id: string, next: ReplaceBufferInput) => void;
  resetAll: () => void;
}

const RECENT_CAP = 10;

function genId(): string {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function emptyBuffer(): Buffer {
  return {
    id: genId(),
    path: null,
    content: '',
    originalContent: '',
    encoding: 'utf-8',
    eol: 'lf',
    dirty: false,
    recordedStat: null,
    externalChange: false,
  };
}

export const useBuffers = create<BuffersState>((set, get) => ({
  buffers: [],
  activeId: null,
  recentlyClosed: [],

  newBuffer: () => {
    const buf = emptyBuffer();
    set((s) => ({ buffers: [...s.buffers, buf], activeId: buf.id }));
    return buf.id;
  },

  openBuffer: (file) => {
    const existing = get().buffers.find((b) => b.path === file.path);
    if (existing) {
      set({ activeId: existing.id });
      return existing.id;
    }
    const buf: Buffer = {
      id: genId(),
      path: file.path,
      content: file.content,
      originalContent: file.content,
      encoding: file.encoding,
      eol: file.eol,
      dirty: false,
      recordedStat: null,
      externalChange: false,
    };
    set((s) => ({ buffers: [...s.buffers, buf], activeId: buf.id }));
    return buf.id;
  },

  openRestored: (input) => {
    const buf: Buffer = {
      id: input.bufferId,
      path: input.path,
      content: input.content,
      originalContent: input.dirty ? '' : input.content,
      encoding: input.encoding,
      eol: input.eol,
      dirty: input.dirty,
      recordedStat: null,
      externalChange: false,
    };
    set((s) => ({ buffers: [...s.buffers, buf], activeId: buf.id }));
    return buf.id;
  },

  closeBuffer: (id) => {
    set((s) => {
      const idx = s.buffers.findIndex((b) => b.id === id);
      if (idx < 0) return s;
      const closed = s.buffers[idx];
      const next = s.buffers.filter((b) => b.id !== id);
      let nextActive: string | null = s.activeId;
      if (s.activeId === id) {
        if (next.length === 0) nextActive = null;
        else if (idx < next.length) nextActive = next[idx].id;
        else nextActive = next[next.length - 1].id;
      }
      const recent = [closed, ...s.recentlyClosed].slice(0, RECENT_CAP);
      return { buffers: next, activeId: nextActive, recentlyClosed: recent };
    });
  },

  switchTo: (id) => {
    set((s) => (s.buffers.some((b) => b.id === id) ? { activeId: id } : s));
  },

  setActiveContent: (next) => {
    set((s) => {
      if (s.activeId == null) return s;
      return {
        buffers: s.buffers.map((b) =>
          b.id === s.activeId
            ? { ...b, content: next, dirty: next !== b.originalContent }
            : b,
        ),
      };
    });
  },

  markSaved: (id, newPath) => {
    set((s) => ({
      buffers: s.buffers.map((b) =>
        b.id === id
          ? { ...b, path: newPath, originalContent: b.content, dirty: false, externalChange: false }
          : b,
      ),
    }));
  },

  setActiveEncoding: (enc) => {
    set((s) => {
      if (s.activeId == null) return s;
      return {
        buffers: s.buffers.map((b) =>
          b.id === s.activeId ? { ...b, encoding: enc, dirty: true } : b,
        ),
      };
    });
  },

  setActiveEol: (eol) => {
    set((s) => {
      if (s.activeId == null) return s;
      return {
        buffers: s.buffers.map((b) =>
          b.id === s.activeId ? { ...b, eol, dirty: true } : b,
        ),
      };
    });
  },

  reorderBuffer: (id, toIndex) => {
    set((s) => {
      const from = s.buffers.findIndex((b) => b.id === id);
      if (from < 0 || toIndex < 0 || toIndex >= s.buffers.length) return s;
      const arr = [...s.buffers];
      const [moved] = arr.splice(from, 1);
      arr.splice(toIndex, 0, moved);
      return { buffers: arr };
    });
  },

  reopenLastClosed: () => {
    const recent = get().recentlyClosed;
    if (recent.length === 0) return null;
    const [restoredOrig, ...rest] = recent;
    // Give it a fresh id so React keys stay stable if the same path is closed again later.
    const restored: Buffer = { ...restoredOrig, id: genId() };
    set((s) => ({
      buffers: [...s.buffers, restored],
      activeId: restored.id,
      recentlyClosed: rest,
    }));
    return restored.id;
  },

  recordStat: (id, stat) => {
    set((s) => ({
      buffers: s.buffers.map((b) => (b.id === id ? { ...b, recordedStat: stat } : b)),
    }));
  },

  setExternalChange: (id, flag) => {
    set((s) => ({
      buffers: s.buffers.map((b) => (b.id === id ? { ...b, externalChange: flag } : b)),
    }));
  },

  replaceBuffer: (id, next) => {
    set((s) => ({
      buffers: s.buffers.map((b) =>
        b.id === id
          ? {
              ...b,
              path: next.path,
              content: next.content,
              originalContent: next.content,
              encoding: next.encoding,
              eol: next.eol,
              dirty: false,
              externalChange: false,
            }
          : b,
      ),
    }));
  },

  resetAll: () => {
    set({ buffers: [], activeId: null, recentlyClosed: [] });
  },
}));

/** Convenience selector for the active buffer. */
export function selectActive(state: BuffersState): Buffer | null {
  if (state.activeId == null) return null;
  return state.buffers.find((b) => b.id === state.activeId) ?? null;
}
