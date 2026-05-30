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
  cursor: number | null;
  scrollTop: number | null;
}

export interface RestoredBufferInput {
  bufferId: string;
  path: string | null;
  content: string;
  encoding: Encoding;
  eol: LineEnding;
  dirty: boolean;
  cursor?: number | null;
  scrollTop?: number | null;
}

export interface ReplaceBufferInput {
  path: string | null;
  content: string;
  encoding: Encoding;
  eol: LineEnding;
}

export interface RestoreSplitInput {
  splitActive: boolean;
  secondaryId: string | null;
  focusedPane: 'primary' | 'secondary';
  secondaryPaneState: Array<{ bufferId: string; cursor: number | null; scrollTop: number | null }>;
}

interface BuffersState {
  buffers: Buffer[];
  activeId: string | null;
  recentlyClosed: Buffer[];
  splitActive: boolean;
  secondaryId: string | null;
  focusedPane: 'primary' | 'secondary';
  secondaryPaneState: Map<string, { cursor: number | null; scrollTop: number | null }>;

  newBuffer: () => string;
  openBuffer: (file: OpenedFile) => string;
  openRestored: (input: RestoredBufferInput) => string;
  closeBuffer: (id: string) => void;
  switchTo: (id: string) => void;
  toggleSplit: () => void;
  restoreSplitState: (input: RestoreSplitInput) => void;
  setFocusedPane: (p: 'primary' | 'secondary') => void;
  setFocusedBuffer: (id: string) => void;
  setActiveContent: (next: string) => void;
  markSaved: (id: string, newPath: string) => void;
  setActiveEncoding: (enc: Encoding) => void;
  setActiveEol: (eol: LineEnding) => void;
  reorderBuffer: (id: string, toIndex: number) => void;
  reopenLastClosed: () => string | null;
  recordStat: (id: string, stat: FileStatSnapshot) => void;
  setExternalChange: (id: string, flag: boolean) => void;
  setCursor: (id: string, cursor: number | null) => void;
  setScrollTop: (id: string, scrollTop: number | null) => void;
  setSecondaryCursor: (bufferId: string, cursor: number | null) => void;
  setSecondaryScrollTop: (bufferId: string, scrollTop: number | null) => void;
  replaceBuffer: (id: string, next: ReplaceBufferInput) => void;
  reloadIfOpen: (path: string) => Promise<void>;
  resetAll: () => void;
  openFileAtLine: (
    path: string,
    line: number,
    range: [number, number],
    snippet: string,
  ) => void;
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
    cursor: null,
    scrollTop: null,
  };
}

/**
 * Route a "show this buffer" action to the focused pane: the secondary pane
 * when the split is active and focused, otherwise the primary pane.
 */
function routeToFocusedPane(s: BuffersState, id: string): Partial<BuffersState> {
  if (s.splitActive && s.focusedPane === 'secondary') {
    return { secondaryId: id };
  }
  return { activeId: id };
}

export const useBuffers = create<BuffersState>((set, get) => ({
  buffers: [],
  activeId: null,
  recentlyClosed: [],
  splitActive: false,
  secondaryId: null,
  focusedPane: 'primary',
  secondaryPaneState: new Map<string, { cursor: number | null; scrollTop: number | null }>(),

  newBuffer: () => {
    const buf = emptyBuffer();
    set((s) => ({ buffers: [...s.buffers, buf], ...routeToFocusedPane(s, buf.id) }));
    return buf.id;
  },

  openBuffer: (file) => {
    const existing = get().buffers.find((b) => b.path === file.path);
    if (existing) {
      set((s) => routeToFocusedPane(s, existing.id));
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
      cursor: null,
      scrollTop: null,
    };
    set((s) => ({ buffers: [...s.buffers, buf], ...routeToFocusedPane(s, buf.id) }));
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
      cursor: input.cursor ?? null,
      scrollTop: input.scrollTop ?? null,
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
      // Index-based advance among the remaining buffers (buffer at the closed
      // index, else the last one), or null if none remain.
      const advance = (): string | null => {
        if (next.length === 0) return null;
        return idx < next.length ? next[idx].id : next[next.length - 1].id;
      };
      let nextActive: string | null = s.activeId;
      if (s.activeId === id) nextActive = advance();
      let nextSecondary: string | null = s.secondaryId;
      if (s.secondaryId === id) nextSecondary = advance();
      let splitActive = s.splitActive;
      let focusedPane = s.focusedPane;
      if (next.length === 0) {
        splitActive = false;
        nextSecondary = null;
        focusedPane = 'primary';
      }
      const recent = [closed, ...s.recentlyClosed].slice(0, RECENT_CAP);
      const nextPaneState = new Map(s.secondaryPaneState);
      nextPaneState.delete(id);
      return {
        buffers: next,
        activeId: nextActive,
        secondaryId: nextSecondary,
        splitActive,
        focusedPane,
        recentlyClosed: recent,
        secondaryPaneState: nextPaneState,
      };
    });
  },

  switchTo: (id) => {
    set((s) => (s.buffers.some((b) => b.id === id) ? routeToFocusedPane(s, id) : s));
  },

  toggleSplit: () => {
    set((s) => {
      if (!s.splitActive) {
        if (s.activeId == null) return s; // nothing to split
        return { splitActive: true, secondaryId: s.activeId, focusedPane: 'secondary' };
      }
      return { splitActive: false, secondaryId: null, focusedPane: 'primary' };
    });
  },

  restoreSplitState: (input) => {
    set((s) => {
      const exists = (id: string | null) =>
        id != null && s.buffers.some((b) => b.id === id);
      const nextPaneState = new Map<string, { cursor: number | null; scrollTop: number | null }>();
      for (const entry of input.secondaryPaneState) {
        if (exists(entry.bufferId)) {
          nextPaneState.set(entry.bufferId, { cursor: entry.cursor, scrollTop: entry.scrollTop });
        }
      }
      if (input.splitActive && exists(input.secondaryId)) {
        return {
          splitActive: true,
          secondaryId: input.secondaryId,
          focusedPane: input.focusedPane,
          secondaryPaneState: nextPaneState,
        };
      }
      return {
        splitActive: false,
        secondaryId: null,
        focusedPane: 'primary',
        secondaryPaneState: nextPaneState,
      };
    });
  },

  setFocusedPane: (p) => {
    set((s) => {
      if (!s.splitActive && p === 'secondary') return s;
      return { focusedPane: p };
    });
  },

  setFocusedBuffer: (id) => {
    set((s) => {
      if (s.focusedPane === 'primary') return { activeId: id };
      return { secondaryId: id };
    });
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
      recentlyClosed: rest,
      ...routeToFocusedPane(s, restored.id),
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

  setCursor: (id, cursor) => {
    set((s) => ({
      buffers: s.buffers.map((b) => (b.id === id ? { ...b, cursor } : b)),
    }));
  },

  setScrollTop: (id, scrollTop) => {
    set((s) => ({
      buffers: s.buffers.map((b) => (b.id === id ? { ...b, scrollTop } : b)),
    }));
  },

  setSecondaryCursor: (bufferId, cursor) => {
    set((s) => {
      const next = new Map(s.secondaryPaneState);
      const existing = next.get(bufferId) ?? { cursor: null, scrollTop: null };
      next.set(bufferId, { ...existing, cursor });
      return { secondaryPaneState: next };
    });
  },

  setSecondaryScrollTop: (bufferId, scrollTop) => {
    set((s) => {
      const next = new Map(s.secondaryPaneState);
      const existing = next.get(bufferId) ?? { cursor: null, scrollTop: null };
      next.set(bufferId, { ...existing, scrollTop });
      return { secondaryPaneState: next };
    });
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
              cursor: null,
              scrollTop: null,
            }
          : b,
      ),
    }));
  },

  async reloadIfOpen(path) {
    const existing = get().buffers.find((b) => b.path === path);
    if (!existing) return;
    if (existing.dirty) return;
    try {
      const { openFile } = await import('../lib/tauri');
      const opened = await openFile(path);
      get().replaceBuffer(existing.id, {
        path: opened.path,
        content: opened.content,
        encoding: opened.encoding,
        eol: opened.eol,
      });
    } catch {
      // Best-effort: swallow.
    }
  },

  resetAll: () => {
    set({
      buffers: [],
      activeId: null,
      recentlyClosed: [],
      splitActive: false,
      secondaryId: null,
      focusedPane: 'primary',
      secondaryPaneState: new Map(),
    });
  },

  openFileAtLine(path, line, range, _snippet) {
    const existing = get().buffers.find((b) => b.path === path);
    if (existing) {
      set((s) => routeToFocusedPane(s, existing.id));
    } else {
      (window as unknown as { __memopadPendingJump?: { path: string; line: number; range: [number, number] } }).__memopadPendingJump = { path, line, range };
    }
    (window as unknown as {
      __memopadJumpEditor?: (line: number, range: [number, number]) => void;
    }).__memopadJumpEditor?.(line, range);
  },
}));

/** Convenience selector for the active buffer. */
export function selectActive(state: BuffersState): Buffer | null {
  if (state.activeId == null) return null;
  return state.buffers.find((b) => b.id === state.activeId) ?? null;
}

/** Convenience selector for the focused buffer (the one user actions target). */
export function selectFocused(state: BuffersState): Buffer | null {
  const id = state.focusedPane === 'primary' ? state.activeId : state.secondaryId;
  if (id == null) return null;
  return state.buffers.find((b) => b.id === id) ?? null;
}

/** Convenience selector for the focused buffer ID. */
export function selectFocusedId(state: BuffersState): string | null {
  return state.focusedPane === 'primary' ? state.activeId : state.secondaryId;
}

/**
 * Pure selector: read cursor + scrollTop for a (pane, buffer) pair.
 * - Primary always reads from the buffer's own fields.
 * - Secondary reads from the Map; if absent, falls back to primary's state
 *   (copy-on-first-mount semantics).
 */
export function selectPaneState(
  state: BuffersState,
  pane: 'primary' | 'secondary',
  bufferId: string | null,
): { cursor: number | null; scrollTop: number | null } {
  if (bufferId == null) return { cursor: null, scrollTop: null };
  const buf = state.buffers.find((b) => b.id === bufferId);
  if (pane === 'primary') {
    return { cursor: buf?.cursor ?? null, scrollTop: buf?.scrollTop ?? null };
  }
  const entry = state.secondaryPaneState.get(bufferId);
  if (entry) return entry;
  return { cursor: buf?.cursor ?? null, scrollTop: buf?.scrollTop ?? null };
}
