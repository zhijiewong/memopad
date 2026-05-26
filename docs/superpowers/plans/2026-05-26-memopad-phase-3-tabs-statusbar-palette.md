# Memopad Phase 3 — Tabs, Status Bar, Command Palette

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-buffer Memopad of Phase 2 into a real multi-tab editor with a clickable status bar and a command palette. After this phase the app supports multiple open files, drag-reorderable tabs, per-tab dirty state, a status bar that lets the user change encoding/EOL, and `Ctrl+K` to run any action.

**Architecture:** The single `useBuffer` Zustand store is replaced with `useBuffers` — an array of buffers plus an active ID and a `recentlyClosed` stack for `Ctrl+Shift+T`. The Editor binds to the active buffer; a new `TabStrip` lives in the title bar drag region and renders one tab per buffer with middle-click-to-close, HTML5 drag-to-reorder, and a right-click context menu. A new `StatusBar` reads cursor state from CodeMirror and exposes click-to-change segments for encoding/EOL/language. Commands are first-class: a tiny `registry` module holds `{id, title, run, shortcut?}` records, every keyboard action also registers a command, and the `CommandPalette` component is a fuzzy-filtered modal over that registry.

**Tech Stack:** No new core deps. We add `tauri-plugin-opener` (back) for "Reveal in Explorer", and `fuzzysort` (~5 KB) for command palette fuzzy matching.

**Spec section reference:** `docs/superpowers/specs/2026-05-25-memopad-design.md` §4.1 (tabs in title bar, status bar segments), §4.2 (command palette), §4.5 (find/replace — out of scope for this phase), §4.6 (keybindings: Ctrl+Tab quick switch, Ctrl+W close, Ctrl+Shift+T reopen).

---

## File Structure

```
memopad/
├── src-tauri/
│   ├── Cargo.toml                          MODIFY — add tauri-plugin-opener
│   ├── capabilities/default.json           MODIFY — allow opener plugin
│   └── src/lib.rs                          MODIFY — register opener plugin + reveal_in_explorer cmd
├── src/
│   ├── stores/
│   │   ├── buffer.ts                       DELETE
│   │   └── buffers.ts                      CREATE — multi-buffer store
│   ├── commands/
│   │   ├── registry.ts                     CREATE — command registry types + Zustand store
│   │   └── builtins.ts                     CREATE — register all built-in commands
│   ├── components/
│   │   ├── TitleBar.tsx                    MODIFY — drop filename display, host TabStrip
│   │   ├── TabStrip.tsx                    CREATE
│   │   ├── TabContextMenu.tsx              CREATE
│   │   ├── StatusBar.tsx                   CREATE
│   │   ├── EncodingPopover.tsx             CREATE
│   │   ├── EolPopover.tsx                  CREATE
│   │   ├── CommandPalette.tsx              CREATE
│   │   └── Editor.tsx                      MODIFY — bind to active buffer; emit cursor changes
│   ├── lib/
│   │   ├── tauri.ts                        MODIFY — add revealInExplorer wrapper
│   │   └── language.ts                     (unchanged)
│   ├── App.tsx                             MODIFY — register builtins, wire palette, new keybindings
│   ├── main.tsx                            MODIFY — update test hooks for multi-buffer
│   └── tests/
│       ├── buffer.test.ts                  DELETE
│       ├── buffers.test.ts                 CREATE
│       └── commands.test.ts                CREATE
└── tests/e2e/
    ├── tabs.spec.ts                        CREATE
    ├── palette.spec.ts                     CREATE
    ├── status-bar.spec.ts                  CREATE
    └── (existing specs)                    MODIFY where they reference the old useBuffer
```

Boundary intent:
- `stores/buffers.ts` owns ALL multi-buffer state. Components never mutate buffer fields directly.
- `commands/registry.ts` is the single source of truth for "what can the user do." Every keyboard handler resolves to a command id; the palette renders the registry.
- `TabStrip` knows about buffers and reordering but never touches Tauri.
- `StatusBar` reads the active buffer + CodeMirror cursor; popovers dispatch encoding/EOL changes back through the buffer store.
- `Editor.tsx` is the only file that imports CodeMirror.

---

## Task 1: Replace single-buffer store with multi-buffer store (TDD)

**Files:**
- Delete: `src/stores/buffer.ts`
- Delete: `src/tests/buffer.test.ts`
- Create: `src/stores/buffers.ts`
- Create: `src/tests/buffers.test.ts`

- [ ] **Step 1: Delete the old files**

```powershell
Remove-Item src/stores/buffer.ts
Remove-Item src/tests/buffer.test.ts
```

These will be replaced. We commit the deletion together with the new files at the end of this task; running `npm test` between will fail (expected — TDD red).

- [ ] **Step 2: Write the failing tests**

Create `src/tests/buffers.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useBuffers } from '../stores/buffers';

describe('buffers store', () => {
  beforeEach(() => {
    useBuffers.getState().resetAll();
  });

  it('starts with no buffers and null active', () => {
    const s = useBuffers.getState();
    expect(s.buffers).to.deep.equal([]);
    expect(s.activeId).to.equal(null);
    expect(s.recentlyClosed).to.deep.equal([]);
  });

  it('newBuffer creates an Untitled buffer, makes it active, and returns its id', () => {
    const id = useBuffers.getState().newBuffer();
    const s = useBuffers.getState();
    expect(s.buffers).to.have.length(1);
    expect(s.activeId).to.equal(id);
    expect(s.buffers[0].path).to.equal(null);
    expect(s.buffers[0].content).to.equal('');
    expect(s.buffers[0].dirty).to.equal(false);
    expect(s.buffers[0].encoding).to.equal('utf-8');
    expect(s.buffers[0].eol).to.equal('lf');
  });

  it('openBuffer adds a buffer with file content + makes it active', () => {
    const id = useBuffers.getState().openBuffer({
      path: '/tmp/x.txt',
      content: 'hi',
      encoding: 'utf-8',
      eol: 'lf',
    });
    const s = useBuffers.getState();
    expect(s.buffers).to.have.length(1);
    expect(s.activeId).to.equal(id);
    expect(s.buffers[0].content).to.equal('hi');
    expect(s.buffers[0].dirty).to.equal(false);
  });

  it('opening the same path twice switches to the existing buffer (no duplicate)', () => {
    const a = useBuffers.getState().openBuffer({
      path: '/tmp/x.txt',
      content: 'hi',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffers.getState().newBuffer(); // create a second tab
    const b = useBuffers.getState().openBuffer({
      path: '/tmp/x.txt',
      content: 'hi',
      encoding: 'utf-8',
      eol: 'lf',
    });
    const s = useBuffers.getState();
    expect(b).to.equal(a);
    expect(s.buffers).to.have.length(2); // original + the Untitled, not 3
    expect(s.activeId).to.equal(a);
  });

  it('setActiveContent dirties the active buffer only', () => {
    const a = useBuffers.getState().newBuffer();
    const b = useBuffers.getState().newBuffer(); // now active
    useBuffers.getState().setActiveContent('typed');
    const s = useBuffers.getState();
    expect(s.buffers.find((x) => x.id === b)!.dirty).to.equal(true);
    expect(s.buffers.find((x) => x.id === a)!.dirty).to.equal(false);
  });

  it('switchTo changes active without touching other state', () => {
    const a = useBuffers.getState().newBuffer();
    const b = useBuffers.getState().newBuffer();
    useBuffers.getState().setActiveContent('on b');
    useBuffers.getState().switchTo(a);
    expect(useBuffers.getState().activeId).to.equal(a);
    expect(useBuffers.getState().buffers.find((x) => x.id === b)!.content).to.equal('on b');
  });

  it('closeBuffer removes the buffer and pushes onto recentlyClosed', () => {
    const a = useBuffers.getState().openBuffer({
      path: '/tmp/x.txt',
      content: 'X',
      encoding: 'utf-8',
      eol: 'lf',
    });
    const b = useBuffers.getState().newBuffer();
    useBuffers.getState().closeBuffer(a);
    const s = useBuffers.getState();
    expect(s.buffers.map((x) => x.id)).to.deep.equal([b]);
    expect(s.activeId).to.equal(b);
    expect(s.recentlyClosed.map((x) => x.path)).to.deep.equal(['/tmp/x.txt']);
  });

  it('closing the active buffer focuses the next tab (or previous at end)', () => {
    const a = useBuffers.getState().newBuffer();
    const b = useBuffers.getState().newBuffer();
    const c = useBuffers.getState().newBuffer();
    // c is active. Closing c should focus b.
    useBuffers.getState().closeBuffer(c);
    expect(useBuffers.getState().activeId).to.equal(b);
    // Now b is active and at end (a, b). Closing b focuses a.
    useBuffers.getState().closeBuffer(b);
    expect(useBuffers.getState().activeId).to.equal(a);
    // Closing last buffer leaves activeId null.
    useBuffers.getState().closeBuffer(a);
    expect(useBuffers.getState().activeId).to.equal(null);
    expect(useBuffers.getState().buffers).to.deep.equal([]);
  });

  it('reopenLastClosed restores the most recently closed buffer', () => {
    const a = useBuffers.getState().openBuffer({
      path: '/tmp/x.txt',
      content: 'X',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffers.getState().closeBuffer(a);
    const restored = useBuffers.getState().reopenLastClosed();
    expect(restored).to.not.equal(null);
    const s = useBuffers.getState();
    expect(s.buffers).to.have.length(1);
    expect(s.buffers[0].path).to.equal('/tmp/x.txt');
    expect(s.activeId).to.equal(restored);
    expect(s.recentlyClosed).to.deep.equal([]);
  });

  it('reopenLastClosed returns null when stack is empty', () => {
    expect(useBuffers.getState().reopenLastClosed()).to.equal(null);
  });

  it('recentlyClosed is capped at 10', () => {
    for (let i = 0; i < 15; i++) {
      const id = useBuffers.getState().newBuffer();
      useBuffers.getState().closeBuffer(id);
    }
    expect(useBuffers.getState().recentlyClosed).to.have.length(10);
  });

  it('reorderBuffer moves a buffer to a new index', () => {
    const a = useBuffers.getState().newBuffer();
    const b = useBuffers.getState().newBuffer();
    const c = useBuffers.getState().newBuffer();
    useBuffers.getState().reorderBuffer(a, 2);
    expect(useBuffers.getState().buffers.map((x) => x.id)).to.deep.equal([b, c, a]);
  });

  it('markSaved clears dirty + updates path on the named buffer', () => {
    const a = useBuffers.getState().newBuffer();
    useBuffers.getState().setActiveContent('hello');
    expect(useBuffers.getState().buffers[0].dirty).to.equal(true);
    useBuffers.getState().markSaved(a, '/tmp/saved.txt');
    const s = useBuffers.getState();
    expect(s.buffers[0].path).to.equal('/tmp/saved.txt');
    expect(s.buffers[0].dirty).to.equal(false);
    expect(s.buffers[0].content).to.equal('hello');
  });
});
```

- [ ] **Step 3: Run tests — confirm failure**

```powershell
npm test
```

Expected: Vitest reports "Cannot find module '../stores/buffers'" (the file doesn't exist yet). Sanity test still passes.

- [ ] **Step 4: Implement the store**

Create `src/stores/buffers.ts`:

```ts
import { create } from 'zustand';

export type Encoding = 'utf-8' | 'utf-8-bom' | 'utf-16-le' | 'utf-16-be';
export type LineEnding = 'lf' | 'crlf' | 'cr';

export interface OpenedFile {
  path: string;
  content: string;
  encoding: Encoding;
  eol: LineEnding;
}

export interface Buffer {
  id: string;
  path: string | null;
  content: string;
  originalContent: string;
  encoding: Encoding;
  eol: LineEnding;
  dirty: boolean;
}

interface BuffersState {
  buffers: Buffer[];
  activeId: string | null;
  recentlyClosed: Buffer[];

  newBuffer: () => string;
  openBuffer: (file: OpenedFile) => string;
  closeBuffer: (id: string) => void;
  switchTo: (id: string) => void;
  setActiveContent: (next: string) => void;
  markSaved: (id: string, newPath: string) => void;
  setActiveEncoding: (enc: Encoding) => void;
  setActiveEol: (eol: LineEnding) => void;
  reorderBuffer: (id: string, toIndex: number) => void;
  reopenLastClosed: () => string | null;
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
        b.id === id ? { ...b, path: newPath, originalContent: b.content, dirty: false } : b,
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

  resetAll: () => {
    set({ buffers: [], activeId: null, recentlyClosed: [] });
  },
}));

/** Convenience selector for the active buffer. */
export function selectActive(state: BuffersState): Buffer | null {
  if (state.activeId == null) return null;
  return state.buffers.find((b) => b.id === state.activeId) ?? null;
}
```

- [ ] **Step 5: Run tests — confirm pass**

```powershell
npm test
```

Expected: 1 sanity + 13 buffers tests + 3 tauri-wrapper tests = 17 passing (the old 6 `buffer` tests are gone, replaced by 13 new ones).

- [ ] **Step 6: Commit**

```powershell
git add -A src/stores src/tests
git commit -m "refactor(stores): replace single useBuffer with multi-buffer useBuffers"
```

---

## Task 2: Update Tauri wrappers, test hooks, Editor and TitleBar for multi-buffer

**Files:**
- Modify: `src/lib/tauri.ts`
- Modify: `src/main.tsx`
- Modify: `src/components/Editor.tsx`
- Modify: `src/components/TitleBar.tsx`

`src/lib/tauri.ts` already imports types from the buffer store. Update the import to point at the new file. The IPC wire format is unchanged.

- [ ] **Step 1: Update src/lib/tauri.ts import path**

In `src/lib/tauri.ts`, change the only line referencing the buffer store:

```ts
import type { OpenedFile, Encoding, LineEnding } from '../stores/buffer';
```

becomes

```ts
import type { OpenedFile, Encoding, LineEnding } from '../stores/buffers';
```

(The rest of the file is unchanged.)

- [ ] **Step 2: Update src/main.tsx test hooks**

Overwrite `src/main.tsx` with EXACTLY:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { useBuffers, selectActive } from './stores/buffers';

// E2E test hooks. Read-only or trivial write-only shims so WebDriver tests can
// drive the store without going through CodeMirror keystroke timing.
const w = window as unknown as {
  __memopadTestSetContent?: (s: string) => void;
  __memopadTestGetContent?: () => string;
  __memopadTestReset?: () => void;
  __memopadTestNewBuffer?: () => string;
  __memopadTestOpenBuffer?: (file: {
    path: string; content: string;
    encoding: 'utf-8' | 'utf-8-bom' | 'utf-16-le' | 'utf-16-be';
    eol: 'lf' | 'crlf' | 'cr';
  }) => string;
  __memopadTestCloseBuffer?: (id: string) => void;
  __memopadTestSwitchTo?: (id: string) => void;
  __memopadTestActiveId?: () => string | null;
  __memopadTestTabIds?: () => string[];
};

w.__memopadTestSetContent = (s) => useBuffers.getState().setActiveContent(s);
w.__memopadTestGetContent = () => selectActive(useBuffers.getState())?.content ?? '';
w.__memopadTestReset = () => useBuffers.getState().resetAll();
w.__memopadTestNewBuffer = () => useBuffers.getState().newBuffer();
w.__memopadTestOpenBuffer = (file) => useBuffers.getState().openBuffer(file);
w.__memopadTestCloseBuffer = (id) => useBuffers.getState().closeBuffer(id);
w.__memopadTestSwitchTo = (id) => useBuffers.getState().switchTo(id);
w.__memopadTestActiveId = () => useBuffers.getState().activeId;
w.__memopadTestTabIds = () => useBuffers.getState().buffers.map((b) => b.id);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 3: Update src/components/Editor.tsx to bind to the active buffer**

Overwrite `src/components/Editor.tsx` with EXACTLY:

```tsx
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { useBuffers, selectActive } from '../stores/buffers';
import { languageForPath } from '../lib/language';

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace' },
  '.cm-content': { padding: '8px 0' },
});

export function Editor() {
  const active = useBuffers(selectActive);
  const setActiveContent = useBuffers((s) => s.setActiveContent);

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-neutral-500">
        Ctrl+O to open · Ctrl+N to start typing
      </div>
    );
  }

  return (
    <CodeMirror
      key={active.id}
      value={active.content}
      height="100%"
      theme={oneDark}
      extensions={[editorTheme, ...languageForPath(active.path)]}
      onChange={setActiveContent}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: false,
        indentOnInput: true,
      }}
    />
  );
}
```

The `key={active.id}` prop forces CodeMirror to remount when you switch tabs — simplest correct behavior for v1, and good enough for tabs of typical file size. Cursor position persistence per tab is deferred to a Phase 4 task (it ships with session restore).

- [ ] **Step 4: Update src/components/TitleBar.tsx (drop filename — the TabStrip will own that)**

Overwrite `src/components/TitleBar.tsx` with EXACTLY:

```tsx
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TabStrip } from './TabStrip';

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;
    invoke<boolean>('window_is_maximized')
      .then((v) => mounted && setMaximized(v))
      .catch(() => {});

    const unlistenPromise = getCurrentWindow().onResized(async () => {
      const v = await invoke<boolean>('window_is_maximized').catch(() => false);
      if (mounted) setMaximized(v);
    });

    return () => {
      mounted = false;
      unlistenPromise.then((un) => un()).catch(() => {});
    };
  }, []);

  return (
    <div className="drag-region flex h-9 select-none items-center justify-between border-b border-neutral-800 bg-neutral-900 text-neutral-300">
      <button
        type="button"
        className="no-drag flex h-full w-9 items-center justify-center text-base hover:bg-neutral-800"
        aria-label="App menu"
      >
        ≡
      </button>

      <div className="no-drag flex-1 overflow-hidden">
        <TabStrip />
      </div>

      <div className="no-drag flex h-full">
        <button
          type="button"
          aria-label="Minimize"
          className="flex h-full w-11 items-center justify-center hover:bg-neutral-800"
          onClick={() => invoke('window_minimize').catch(console.error)}
        >
          &#x2013;
        </button>
        <button
          type="button"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          className="flex h-full w-11 items-center justify-center hover:bg-neutral-800"
          onClick={() => invoke('window_toggle_maximize').catch(console.error)}
        >
          {maximized ? '❐' : '☐'}
        </button>
        <button
          type="button"
          aria-label="Close"
          className="flex h-full w-11 items-center justify-center hover:bg-red-600 hover:text-white"
          onClick={() => invoke('window_close').catch(console.error)}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
```

This will not typecheck until Task 3 creates `TabStrip.tsx` — we accept one red intermediate state and commit at the end of Task 3.

- [ ] **Step 5: Hold the commit**

Do NOT commit yet — the import of `./TabStrip` is a dangling reference. Continue to Task 3.

---

## Task 3: TabStrip component (render + click-to-switch + dirty dot per tab)

**Files:**
- Create: `src/components/TabStrip.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/TabStrip.tsx` with EXACTLY:

```tsx
import { useBuffers } from '../stores/buffers';

function fileNameOf(path: string | null, untitledIndex: number): string {
  if (!path) return `Untitled${untitledIndex > 1 ? ' ' + untitledIndex : ''}`;
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

export function TabStrip() {
  const buffers = useBuffers((s) => s.buffers);
  const activeId = useBuffers((s) => s.activeId);
  const switchTo = useBuffers((s) => s.switchTo);
  const closeBuffer = useBuffers((s) => s.closeBuffer);

  if (buffers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs tracking-wide text-neutral-500">
        Memopad
      </div>
    );
  }

  let untitledCounter = 0;

  return (
    <div className="flex h-full items-stretch overflow-x-auto">
      {buffers.map((b) => {
        const isActive = b.id === activeId;
        const isUntitled = b.path === null;
        const idx = isUntitled ? ++untitledCounter : 0;
        const name = fileNameOf(b.path, idx);
        return (
          <div
            key={b.id}
            role="tab"
            aria-selected={isActive}
            data-buffer-id={b.id}
            onClick={() => switchTo(b.id)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeBuffer(b.id);
              }
            }}
            className={
              'group flex h-full max-w-[200px] cursor-pointer items-center gap-1 border-r border-neutral-800 px-3 text-xs '
              + (isActive
                ? 'bg-neutral-950 text-neutral-100 shadow-[inset_0_-2px_0_0_theme(colors.amber.400)]'
                : 'text-neutral-400 hover:bg-neutral-800/60')
            }
            title={b.path ?? name}
          >
            <span className="truncate">{name}</span>
            {b.dirty && (
              <span aria-label="Unsaved changes" className="text-amber-400">●</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: exit 0. The TitleBar's import of `./TabStrip` from Task 2 is now resolved.

- [ ] **Step 3: Commit Tasks 2 + 3 together**

```powershell
git add src/lib/tauri.ts src/main.tsx src/components/Editor.tsx src/components/TitleBar.tsx src/components/TabStrip.tsx
git commit -m "ui: TabStrip in title bar; Editor + TitleBar rebound to multi-buffer store"
```

---

## Task 4: Update App.tsx open/save/new flow for multi-buffer

**Files:**
- Modify: `src/App.tsx`

The current App.tsx has a single keydown handler that operates on `useBuffer`. Rewrite it to operate on the multi-buffer store: Ctrl+O opens into a NEW buffer (or switches if path already open), Ctrl+S saves the active buffer, Ctrl+N opens a new empty tab, Ctrl+W closes the active tab, Ctrl+Shift+T reopens the last closed.

- [ ] **Step 1: Overwrite src/App.tsx**

```tsx
import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Editor } from './components/Editor';
import { useBuffers, selectActive } from './stores/buffers';
import { openFile, saveFile } from './lib/tauri';
import { pickFileToOpen, pickFileToSave } from './lib/dialog';

async function doOpen() {
  const path = await pickFileToOpen();
  if (!path) return;
  try {
    const opened = await openFile(path);
    useBuffers.getState().openBuffer(opened);
  } catch (err) {
    console.error('open failed:', err);
  }
}

async function doSave(saveAs: boolean) {
  const active = selectActive(useBuffers.getState());
  if (!active) return;
  let path = active.path;
  if (!path || saveAs) {
    const picked = await pickFileToSave(path);
    if (!picked) return;
    path = picked;
  }
  try {
    await saveFile(path, active.content, active.encoding, active.eol);
    useBuffers.getState().markSaved(active.id, path);
  } catch (err) {
    console.error('save failed:', err);
  }
}

export default function App() {
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      if (key === 'o' && !e.shiftKey) {
        e.preventDefault();
        await doOpen();
        return;
      }
      if (key === 's' && !e.shiftKey) {
        e.preventDefault();
        await doSave(false);
        return;
      }
      if (key === 's' && e.shiftKey) {
        e.preventDefault();
        await doSave(true);
        return;
      }
      if (key === 'n' && !e.shiftKey) {
        e.preventDefault();
        useBuffers.getState().newBuffer();
        return;
      }
      if (key === 'w' && !e.shiftKey) {
        e.preventDefault();
        const id = useBuffers.getState().activeId;
        if (id) useBuffers.getState().closeBuffer(id);
        return;
      }
      if (key === 't' && e.shiftKey) {
        e.preventDefault();
        useBuffers.getState().reopenLastClosed();
        return;
      }
      if (key === 'tab') {
        e.preventDefault();
        const { buffers, activeId } = useBuffers.getState();
        if (buffers.length < 2) return;
        const idx = buffers.findIndex((b) => b.id === activeId);
        const dir = e.shiftKey ? -1 : 1;
        const nextIdx = (idx + dir + buffers.length) % buffers.length;
        useBuffers.getState().switchTo(buffers[nextIdx].id);
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <TitleBar />
      <main className="flex flex-1 overflow-hidden">
        <Editor />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```powershell
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```powershell
git add src/App.tsx
git commit -m "ui(app): multi-buffer Ctrl+O/S/Shift+S/N/W/Shift+T/Tab keybindings"
```

---

## Task 5: Update e2e tests for multi-buffer & confirm full suite still passes

**Files:**
- Modify: `tests/e2e/editor.spec.ts`
- Modify: `tests/e2e/support/helpers.ts`

The existing `editor.spec.ts` resets the buffer via `__memopadTestReset` (which now does a `resetAll`) — that's fine. But `setEditorContent` requires an active buffer to exist; if `resetAll` left zero buffers, `setActiveContent` will be a no-op and the dirty assertion will fail. Adjust the helper to ensure an active buffer exists.

- [ ] **Step 1: Update `tests/e2e/support/helpers.ts` — resetBuffer creates a fresh empty buffer**

In `tests/e2e/support/helpers.ts`, locate the `resetBuffer` function and replace its body so that after reset there is one active untitled buffer:

```ts
export async function resetBuffer(): Promise<void> {
  const browser = getBrowser();
  await browser.execute(() => {
    const win = window as unknown as {
      __memopadTestReset?: () => void;
      __memopadTestNewBuffer?: () => string;
    };
    if (!win.__memopadTestReset || !win.__memopadTestNewBuffer) {
      throw new Error('Test hooks missing.');
    }
    win.__memopadTestReset();
    win.__memopadTestNewBuffer();
  });
}
```

Leave everything else in the file unchanged.

- [ ] **Step 2: Verify the build still works and run the suite**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Get-Process | Where-Object { $_.ProcessName -match '^(tauri-driver|msedgedriver|app)$' } | Stop-Process -Force -ErrorAction SilentlyContinue
npm test
npm run test:e2e
```

Expected: Vitest 17 passing, e2e 11 passing.

Stop drivers afterward:
```powershell
Get-Process | Where-Object { $_.ProcessName -match '^(tauri-driver|msedgedriver|app)$' } | Stop-Process -Force -ErrorAction SilentlyContinue
```

- [ ] **Step 3: Commit**

```powershell
git add tests/e2e/support/helpers.ts
git commit -m "test(e2e): resetBuffer creates an untitled tab so setActiveContent works"
```

---

## Task 6: Drag-to-reorder tabs (HTML5 drag API)

**Files:**
- Modify: `src/components/TabStrip.tsx`

- [ ] **Step 1: Add drag handlers to the tab element**

Overwrite `src/components/TabStrip.tsx` with EXACTLY (changes: `draggable`, `onDragStart`, `onDragOver`, `onDrop`):

```tsx
import { useState } from 'react';
import { useBuffers } from '../stores/buffers';

function fileNameOf(path: string | null, untitledIndex: number): string {
  if (!path) return `Untitled${untitledIndex > 1 ? ' ' + untitledIndex : ''}`;
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

export function TabStrip() {
  const buffers = useBuffers((s) => s.buffers);
  const activeId = useBuffers((s) => s.activeId);
  const switchTo = useBuffers((s) => s.switchTo);
  const closeBuffer = useBuffers((s) => s.closeBuffer);
  const reorderBuffer = useBuffers((s) => s.reorderBuffer);

  const [dragId, setDragId] = useState<string | null>(null);

  if (buffers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs tracking-wide text-neutral-500">
        Memopad
      </div>
    );
  }

  let untitledCounter = 0;

  return (
    <div className="flex h-full items-stretch overflow-x-auto">
      {buffers.map((b, idx) => {
        const isActive = b.id === activeId;
        const isUntitled = b.path === null;
        const fileIdx = isUntitled ? ++untitledCounter : 0;
        const name = fileNameOf(b.path, fileIdx);
        return (
          <div
            key={b.id}
            role="tab"
            aria-selected={isActive}
            data-buffer-id={b.id}
            draggable
            onDragStart={(e) => {
              setDragId(b.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (dragId && dragId !== b.id) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }
            }}
            onDrop={(e) => {
              if (dragId && dragId !== b.id) {
                e.preventDefault();
                reorderBuffer(dragId, idx);
              }
              setDragId(null);
            }}
            onDragEnd={() => setDragId(null)}
            onClick={() => switchTo(b.id)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeBuffer(b.id);
              }
            }}
            className={
              'group flex h-full max-w-[200px] cursor-pointer items-center gap-1 border-r border-neutral-800 px-3 text-xs '
              + (isActive
                ? 'bg-neutral-950 text-neutral-100 shadow-[inset_0_-2px_0_0_theme(colors.amber.400)]'
                : 'text-neutral-400 hover:bg-neutral-800/60')
              + (dragId === b.id ? ' opacity-50' : '')
            }
            title={b.path ?? name}
          >
            <span className="truncate">{name}</span>
            {b.dirty && (
              <span aria-label="Unsaved changes" className="text-amber-400">●</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```powershell
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```powershell
git add src/components/TabStrip.tsx
git commit -m "ui(tabs): drag to reorder via HTML5 drag API"
```

---

## Task 7: Right-click context menu — Close / Close Others / Close to Right / Copy Path / Reveal in Explorer

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src/lib/tauri.ts`
- Create: `src/components/TabContextMenu.tsx`
- Modify: `src/components/TabStrip.tsx`

We use a custom HTML popover for the menu (matches the chromeless aesthetic and is testable). "Reveal in Explorer" needs a Rust command.

- [ ] **Step 1: Add tauri-plugin-opener and a reveal_in_explorer command**

Open `src-tauri/Cargo.toml` and add to `[dependencies]`:
```toml
tauri-plugin-opener = "2"
```

Open `src-tauri/src/lib.rs` and overwrite with EXACTLY:

```rust
mod fs;

use std::process::Command;

#[tauri::command]
fn window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_toggle_maximize(window: tauri::Window) -> Result<(), String> {
    let is_max = window.is_maximized().map_err(|e| e.to_string())?;
    if is_max {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn window_close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_is_maximized(window: tauri::Window) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    Command::new("explorer.exe")
        .arg("/select,")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("explorer /select,{}: {}", path, e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_is_maximized,
            reveal_in_explorer,
            fs::open_file,
            fs::save_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Open `src-tauri/capabilities/default.json` and overwrite with EXACTLY:
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "enables the default permissions",
  "windows": [
    "main"
  ],
  "permissions": [
    "core:default",
    "dialog:default",
    "opener:default"
  ]
}
```

- [ ] **Step 2: Verify Rust compiles**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Set-Location src-tauri
cargo check
Set-Location ..
```

- [ ] **Step 3: Add the JS wrapper for reveal_in_explorer**

In `src/lib/tauri.ts`, after the `saveFile` export, ADD:

```ts
export async function revealInExplorer(filePath: string): Promise<void> {
  try {
    await invoke<void>('reveal_in_explorer', { path: filePath });
  } catch (e) {
    throw asError(e);
  }
}
```

- [ ] **Step 4: Create TabContextMenu component**

Create `src/components/TabContextMenu.tsx`:

```tsx
import { useEffect, useRef } from 'react';

export interface TabContextMenuItem {
  label: string;
  enabled: boolean;
  onClick: () => void;
}

interface Props {
  x: number;
  y: number;
  items: TabContextMenuItem[];
  onClose: () => void;
}

export function TabContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-[180px] rounded border border-neutral-700 bg-neutral-900 py-1 text-xs text-neutral-200 shadow-lg"
    >
      {items.map((item, i) => (
        <button
          key={i}
          role="menuitem"
          disabled={!item.enabled}
          onClick={() => {
            if (item.enabled) {
              item.onClick();
              onClose();
            }
          }}
          className="block w-full px-3 py-1.5 text-left enabled:hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-500"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Wire context menu into TabStrip**

Overwrite `src/components/TabStrip.tsx` with EXACTLY:

```tsx
import { useState } from 'react';
import { useBuffers } from '../stores/buffers';
import { TabContextMenu } from './TabContextMenu';
import { revealInExplorer } from '../lib/tauri';

function fileNameOf(path: string | null, untitledIndex: number): string {
  if (!path) return `Untitled${untitledIndex > 1 ? ' ' + untitledIndex : ''}`;
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

export function TabStrip() {
  const buffers = useBuffers((s) => s.buffers);
  const activeId = useBuffers((s) => s.activeId);
  const switchTo = useBuffers((s) => s.switchTo);
  const closeBuffer = useBuffers((s) => s.closeBuffer);
  const reorderBuffer = useBuffers((s) => s.reorderBuffer);

  const [dragId, setDragId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; bufferId: string } | null>(null);

  const closeOthers = (keepId: string) => {
    const ids = useBuffers.getState().buffers.map((b) => b.id);
    for (const id of ids) if (id !== keepId) closeBuffer(id);
  };

  const closeToRight = (fromId: string) => {
    const all = useBuffers.getState().buffers;
    const fromIdx = all.findIndex((b) => b.id === fromId);
    if (fromIdx < 0) return;
    const idsToClose = all.slice(fromIdx + 1).map((b) => b.id);
    for (const id of idsToClose) closeBuffer(id);
  };

  if (buffers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs tracking-wide text-neutral-500">
        Memopad
      </div>
    );
  }

  let untitledCounter = 0;
  const ctxBuffer = ctx ? buffers.find((b) => b.id === ctx.bufferId) : null;

  return (
    <>
      <div className="flex h-full items-stretch overflow-x-auto">
        {buffers.map((b, idx) => {
          const isActive = b.id === activeId;
          const isUntitled = b.path === null;
          const fileIdx = isUntitled ? ++untitledCounter : 0;
          const name = fileNameOf(b.path, fileIdx);
          return (
            <div
              key={b.id}
              role="tab"
              aria-selected={isActive}
              data-buffer-id={b.id}
              draggable
              onDragStart={(e) => {
                setDragId(b.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (dragId && dragId !== b.id) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(e) => {
                if (dragId && dragId !== b.id) {
                  e.preventDefault();
                  reorderBuffer(dragId, idx);
                }
                setDragId(null);
              }}
              onDragEnd={() => setDragId(null)}
              onClick={() => switchTo(b.id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeBuffer(b.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtx({ x: e.clientX, y: e.clientY, bufferId: b.id });
              }}
              className={
                'group flex h-full max-w-[200px] cursor-pointer items-center gap-1 border-r border-neutral-800 px-3 text-xs '
                + (isActive
                  ? 'bg-neutral-950 text-neutral-100 shadow-[inset_0_-2px_0_0_theme(colors.amber.400)]'
                  : 'text-neutral-400 hover:bg-neutral-800/60')
                + (dragId === b.id ? ' opacity-50' : '')
              }
              title={b.path ?? name}
            >
              <span className="truncate">{name}</span>
              {b.dirty && (
                <span aria-label="Unsaved changes" className="text-amber-400">●</span>
              )}
            </div>
          );
        })}
      </div>

      {ctx && ctxBuffer && (
        <TabContextMenu
          x={ctx.x}
          y={ctx.y}
          items={[
            { label: 'Close', enabled: true, onClick: () => closeBuffer(ctx.bufferId) },
            { label: 'Close Others', enabled: buffers.length > 1, onClick: () => closeOthers(ctx.bufferId) },
            {
              label: 'Close to Right',
              enabled: buffers.findIndex((b) => b.id === ctx.bufferId) < buffers.length - 1,
              onClick: () => closeToRight(ctx.bufferId),
            },
            {
              label: 'Copy Path',
              enabled: ctxBuffer.path !== null,
              onClick: () => {
                if (ctxBuffer.path) navigator.clipboard.writeText(ctxBuffer.path).catch(() => {});
              },
            },
            {
              label: 'Reveal in Explorer',
              enabled: ctxBuffer.path !== null,
              onClick: () => {
                if (ctxBuffer.path) revealInExplorer(ctxBuffer.path).catch(console.error);
              },
            },
          ]}
          onClose={() => setCtx(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 6: TS check + commit**

```powershell
npx tsc --noEmit
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json src/lib/tauri.ts src/components/TabContextMenu.tsx src/components/TabStrip.tsx
git commit -m "ui(tabs): right-click menu with close/copy-path/reveal-in-explorer"
```

---

## Task 8: Command registry + tests

**Files:**
- Create: `src/commands/registry.ts`
- Create: `src/tests/commands.test.ts`

- [ ] **Step 1: Install fuzzysort**

```powershell
npm install "fuzzysort@^3.0.0"
```

- [ ] **Step 2: Write the failing tests**

Create `src/tests/commands.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCommands, search } from '../commands/registry';

describe('command registry', () => {
  beforeEach(() => useCommands.getState().reset());

  it('starts empty', () => {
    expect(useCommands.getState().commands).to.deep.equal([]);
  });

  it('register adds a command', () => {
    let calls = 0;
    useCommands.getState().register({
      id: 'file.save',
      title: 'File: Save',
      run: () => { calls += 1; },
    });
    expect(useCommands.getState().commands).to.have.length(1);
    useCommands.getState().commands[0].run();
    expect(calls).to.equal(1);
  });

  it('register replaces a command with the same id', () => {
    useCommands.getState().register({ id: 'x', title: 'first', run: () => {} });
    useCommands.getState().register({ id: 'x', title: 'second', run: () => {} });
    expect(useCommands.getState().commands).to.have.length(1);
    expect(useCommands.getState().commands[0].title).to.equal('second');
  });

  it('search returns commands whose title fuzzy-matches the query', () => {
    useCommands.getState().register({ id: 'a', title: 'Open File', run: () => {} });
    useCommands.getState().register({ id: 'b', title: 'Save File', run: () => {} });
    useCommands.getState().register({ id: 'c', title: 'New Tab', run: () => {} });

    const r1 = search('ope').map((m) => m.command.id);
    expect(r1).to.include('a');
    expect(r1).to.not.include('c');

    const r2 = search('file').map((m) => m.command.id);
    expect(r2).to.include.members(['a', 'b']);
    expect(r2).to.not.include('c');
  });

  it('search with empty query returns all commands in recent-first order', () => {
    useCommands.getState().register({ id: 'a', title: 'A', run: () => {} });
    useCommands.getState().register({ id: 'b', title: 'B', run: () => {} });
    useCommands.getState().register({ id: 'c', title: 'C', run: () => {} });
    useCommands.getState().recordUsed('b');
    useCommands.getState().recordUsed('a');
    const ids = search('').map((m) => m.command.id);
    expect(ids[0]).to.equal('a');
    expect(ids[1]).to.equal('b');
    // c (never used) comes after the recent ones; order among never-used items is registration order.
    expect(ids[2]).to.equal('c');
  });
});
```

- [ ] **Step 3: Run — confirm failure**

```powershell
npm test
```

Expected: cannot find module `../commands/registry`.

- [ ] **Step 4: Implement the registry**

Create `src/commands/registry.ts`:

```ts
import { create } from 'zustand';
import fuzzysort from 'fuzzysort';

export interface Command {
  id: string;
  title: string;
  shortcut?: string;
  run: () => void | Promise<void>;
}

export interface SearchMatch {
  command: Command;
  score: number;
}

interface CommandsState {
  commands: Command[];
  /** Most-recent-first list of command ids that were run. */
  recent: string[];
  register: (cmd: Command) => void;
  unregister: (id: string) => void;
  recordUsed: (id: string) => void;
  reset: () => void;
}

const RECENT_CAP = 20;

export const useCommands = create<CommandsState>((set) => ({
  commands: [],
  recent: [],
  register: (cmd) =>
    set((s) => {
      const without = s.commands.filter((c) => c.id !== cmd.id);
      return { commands: [...without, cmd] };
    }),
  unregister: (id) =>
    set((s) => ({ commands: s.commands.filter((c) => c.id !== id) })),
  recordUsed: (id) =>
    set((s) => ({ recent: [id, ...s.recent.filter((x) => x !== id)].slice(0, RECENT_CAP) })),
  reset: () => set({ commands: [], recent: [] }),
}));

export function search(query: string): SearchMatch[] {
  const { commands, recent } = useCommands.getState();
  if (!query) {
    const recentSet = new Set(recent);
    const recentMatches: SearchMatch[] = [];
    for (const id of recent) {
      const cmd = commands.find((c) => c.id === id);
      if (cmd) recentMatches.push({ command: cmd, score: 0 });
    }
    const others = commands
      .filter((c) => !recentSet.has(c.id))
      .map((c) => ({ command: c, score: 0 }));
    return [...recentMatches, ...others];
  }
  const results = fuzzysort.go(query, commands, { key: 'title', threshold: -1000 });
  return results.map((r) => ({ command: r.obj, score: r.score }));
}
```

- [ ] **Step 5: Run — confirm pass**

```powershell
npm test
```

Expected: 17 (existing) + 5 (commands) = 22 passing.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json src/commands/registry.ts src/tests/commands.test.ts
git commit -m "ui(commands): registry + fuzzy search with recent-first ordering"
```

---

## Task 9: Built-in commands registry

**Files:**
- Create: `src/commands/builtins.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create builtins.ts**

Create `src/commands/builtins.ts`:

```ts
import { useBuffers, selectActive } from '../stores/buffers';
import { openFile, saveFile, revealInExplorer } from '../lib/tauri';
import { pickFileToOpen, pickFileToSave } from '../lib/dialog';
import { useCommands } from './registry';

async function doOpen() {
  const path = await pickFileToOpen();
  if (!path) return;
  try {
    const opened = await openFile(path);
    useBuffers.getState().openBuffer(opened);
  } catch (err) {
    console.error('open failed:', err);
  }
}

async function doSave(saveAs: boolean) {
  const active = selectActive(useBuffers.getState());
  if (!active) return;
  let path = active.path;
  if (!path || saveAs) {
    const picked = await pickFileToSave(path);
    if (!picked) return;
    path = picked;
  }
  try {
    await saveFile(path, active.content, active.encoding, active.eol);
    useBuffers.getState().markSaved(active.id, path);
  } catch (err) {
    console.error('save failed:', err);
  }
}

export function registerBuiltins() {
  const { register } = useCommands.getState();

  register({ id: 'file.new', title: 'File: New', shortcut: 'Ctrl+N', run: () => useBuffers.getState().newBuffer() });
  register({ id: 'file.open', title: 'File: Open…', shortcut: 'Ctrl+O', run: doOpen });
  register({ id: 'file.save', title: 'File: Save', shortcut: 'Ctrl+S', run: () => doSave(false) });
  register({ id: 'file.saveAs', title: 'File: Save As…', shortcut: 'Ctrl+Shift+S', run: () => doSave(true) });

  register({
    id: 'tab.close',
    title: 'Tab: Close',
    shortcut: 'Ctrl+W',
    run: () => {
      const id = useBuffers.getState().activeId;
      if (id) useBuffers.getState().closeBuffer(id);
    },
  });
  register({
    id: 'tab.reopen',
    title: 'Tab: Reopen Closed',
    shortcut: 'Ctrl+Shift+T',
    run: () => useBuffers.getState().reopenLastClosed(),
  });
  register({
    id: 'tab.next',
    title: 'Tab: Next',
    shortcut: 'Ctrl+Tab',
    run: () => {
      const { buffers, activeId } = useBuffers.getState();
      if (buffers.length < 2) return;
      const idx = buffers.findIndex((b) => b.id === activeId);
      const next = (idx + 1) % buffers.length;
      useBuffers.getState().switchTo(buffers[next].id);
    },
  });
  register({
    id: 'tab.prev',
    title: 'Tab: Previous',
    shortcut: 'Ctrl+Shift+Tab',
    run: () => {
      const { buffers, activeId } = useBuffers.getState();
      if (buffers.length < 2) return;
      const idx = buffers.findIndex((b) => b.id === activeId);
      const prev = (idx - 1 + buffers.length) % buffers.length;
      useBuffers.getState().switchTo(buffers[prev].id);
    },
  });

  register({
    id: 'tab.copyPath',
    title: 'Tab: Copy Path',
    run: () => {
      const a = selectActive(useBuffers.getState());
      if (a?.path) navigator.clipboard.writeText(a.path).catch(() => {});
    },
  });
  register({
    id: 'tab.revealInExplorer',
    title: 'Tab: Reveal in Explorer',
    run: () => {
      const a = selectActive(useBuffers.getState());
      if (a?.path) revealInExplorer(a.path).catch(console.error);
    },
  });
}
```

- [ ] **Step 2: Call registerBuiltins from App.tsx**

In `src/App.tsx`, replace its current contents with EXACTLY:

```tsx
import { useEffect, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { Editor } from './components/Editor';
import { CommandPalette } from './components/CommandPalette';
import { useCommands } from './commands/registry';
import { registerBuiltins } from './commands/builtins';

registerBuiltins();

function runCommand(id: string) {
  const cmd = useCommands.getState().commands.find((c) => c.id === id);
  if (!cmd) return;
  useCommands.getState().recordUsed(id);
  cmd.run();
}

export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      // Command palette
      if (key === 'k' && !e.shiftKey) {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (key === 'p' && e.shiftKey) {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }

      // File ops
      if (key === 'o' && !e.shiftKey) { e.preventDefault(); runCommand('file.open'); return; }
      if (key === 's' && !e.shiftKey) { e.preventDefault(); runCommand('file.save'); return; }
      if (key === 's' && e.shiftKey)  { e.preventDefault(); runCommand('file.saveAs'); return; }
      if (key === 'n' && !e.shiftKey) { e.preventDefault(); runCommand('file.new'); return; }

      // Tab ops
      if (key === 'w' && !e.shiftKey) { e.preventDefault(); runCommand('tab.close'); return; }
      if (key === 't' && e.shiftKey)  { e.preventDefault(); runCommand('tab.reopen'); return; }
      if (key === 'tab' && !e.shiftKey) { e.preventDefault(); runCommand('tab.next'); return; }
      if (key === 'tab' && e.shiftKey)  { e.preventDefault(); runCommand('tab.prev'); return; }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <TitleBar />
      <main className="flex flex-1 overflow-hidden">
        <Editor />
      </main>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onRun={runCommand} />}
    </div>
  );
}

// expose runCommand for the e2e tests (used by palette.spec.ts)
(window as unknown as { __memopadTestRunCommand?: (id: string) => void }).__memopadTestRunCommand = runCommand;
```

- [ ] **Step 3: TS check — confirm a single error about CommandPalette missing**

```powershell
npx tsc --noEmit
```

Expected: one error about `./components/CommandPalette` not found. That's resolved by Task 10. Do NOT commit yet.

---

## Task 10: CommandPalette component

**Files:**
- Create: `src/components/CommandPalette.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/CommandPalette.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { search, type SearchMatch } from '../commands/registry';

interface Props {
  onClose: () => void;
  onRun: (id: string) => void;
}

export function CommandPalette({ onClose, onRun }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches: SearchMatch[] = search(query).slice(0, 20);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, matches.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const m = matches[selectedIdx];
      if (m) {
        onRun(m.command.id);
        onClose();
      }
      return;
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Command Palette"
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-24"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[520px] max-w-[80vw] overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 shadow-2xl">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="Type a command…"
          className="w-full border-b border-neutral-800 bg-transparent px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
        />
        <ul className="max-h-[360px] overflow-y-auto py-1" role="listbox">
          {matches.length === 0 && (
            <li className="px-4 py-3 text-xs text-neutral-500">No matching commands</li>
          )}
          {matches.map((m, i) => {
            const isSelected = i === selectedIdx;
            return (
              <li
                key={m.command.id}
                role="option"
                aria-selected={isSelected}
                data-command-id={m.command.id}
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => { onRun(m.command.id); onClose(); }}
                className={
                  'flex cursor-pointer items-center justify-between px-4 py-1.5 text-sm '
                  + (isSelected ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-300')
                }
              >
                <span>{m.command.title}</span>
                {m.command.shortcut && (
                  <span className="text-xs text-neutral-500">{m.command.shortcut}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TS check + commit Tasks 9 + 10 together**

```powershell
npx tsc --noEmit
git add src/commands/builtins.ts src/components/CommandPalette.tsx src/App.tsx
git commit -m "ui(palette): Ctrl+K command palette with builtin commands"
```

---

## Task 11: StatusBar component (display only)

**Files:**
- Create: `src/components/StatusBar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/StatusBar.tsx`:

```tsx
import { useBuffers, selectActive, type Encoding, type LineEnding } from '../stores/buffers';
import { languageForPath } from '../lib/language';

function encodingLabel(e: Encoding): string {
  switch (e) {
    case 'utf-8': return 'UTF-8';
    case 'utf-8-bom': return 'UTF-8 BOM';
    case 'utf-16-le': return 'UTF-16 LE';
    case 'utf-16-be': return 'UTF-16 BE';
  }
}

function eolLabel(e: LineEnding): string {
  return e.toUpperCase();
}

function languageLabel(path: string | null): string {
  if (!path) return 'Plain';
  const ext = path.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    rs: 'Rust', js: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', tsx: 'TSX',
    json: 'JSON', md: 'Markdown', markdown: 'Markdown',
  };
  return map[ext] ?? 'Plain';
}

export function StatusBar() {
  const active = useBuffers(selectActive);
  if (!active) {
    return <div className="h-6 border-t border-neutral-800 bg-neutral-900" />;
  }
  // Force read of languageForPath so we get a TS error if its signature changes.
  void languageForPath;
  return (
    <div className="flex h-6 select-none items-center gap-3 border-t border-neutral-800 bg-neutral-900 px-3 text-[11px] text-neutral-400">
      <span data-status-segment="language">{languageLabel(active.path)}</span>
      <span data-status-segment="encoding">{encodingLabel(active.encoding)}</span>
      <span data-status-segment="eol">{eolLabel(active.eol)}</span>
    </div>
  );
}
```

- [ ] **Step 2: Mount StatusBar in App.tsx**

In `src/App.tsx`, change the return JSX. Find the block:

```tsx
      <main className="flex flex-1 overflow-hidden">
        <Editor />
      </main>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onRun={runCommand} />}
    </div>
```

Replace with:

```tsx
      <main className="flex flex-1 overflow-hidden">
        <Editor />
      </main>
      <StatusBar />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onRun={runCommand} />}
    </div>
```

And add `import { StatusBar } from './components/StatusBar';` near the other component imports.

- [ ] **Step 3: TS check + commit**

```powershell
npx tsc --noEmit
git add src/components/StatusBar.tsx src/App.tsx
git commit -m "ui(status): display-only status bar (language/encoding/EOL)"
```

---

## Task 12: Clickable encoding + EOL popovers

**Files:**
- Create: `src/components/EncodingPopover.tsx`
- Create: `src/components/EolPopover.tsx`
- Modify: `src/components/StatusBar.tsx`

- [ ] **Step 1: Create EncodingPopover**

Create `src/components/EncodingPopover.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import type { Encoding } from '../stores/buffers';

const OPTIONS: { value: Encoding; label: string }[] = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-8-bom', label: 'UTF-8 BOM' },
  { value: 'utf-16-le', label: 'UTF-16 LE' },
  { value: 'utf-16-be', label: 'UTF-16 BE' },
];

interface Props {
  current: Encoding;
  anchorRect: DOMRect;
  onSelect: (next: Encoding) => void;
  onClose: () => void;
}

export function EncodingPopover({ current, anchorRect, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: anchorRect.left, bottom: window.innerHeight - anchorRect.top + 4 }}
      className="fixed z-50 min-w-[140px] rounded border border-neutral-700 bg-neutral-900 py-1 text-xs text-neutral-200 shadow-lg"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => { onSelect(opt.value); onClose(); }}
          className={
            'block w-full px-3 py-1.5 text-left hover:bg-neutral-800 '
            + (opt.value === current ? 'text-amber-400' : '')
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create EolPopover**

Create `src/components/EolPopover.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import type { LineEnding } from '../stores/buffers';

const OPTIONS: { value: LineEnding; label: string }[] = [
  { value: 'lf', label: 'LF' },
  { value: 'crlf', label: 'CRLF' },
  { value: 'cr', label: 'CR' },
];

interface Props {
  current: LineEnding;
  anchorRect: DOMRect;
  onSelect: (next: LineEnding) => void;
  onClose: () => void;
}

export function EolPopover({ current, anchorRect, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: anchorRect.left, bottom: window.innerHeight - anchorRect.top + 4 }}
      className="fixed z-50 min-w-[100px] rounded border border-neutral-700 bg-neutral-900 py-1 text-xs text-neutral-200 shadow-lg"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => { onSelect(opt.value); onClose(); }}
          className={
            'block w-full px-3 py-1.5 text-left hover:bg-neutral-800 '
            + (opt.value === current ? 'text-amber-400' : '')
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Wire popovers into StatusBar**

Overwrite `src/components/StatusBar.tsx` with EXACTLY:

```tsx
import { useState } from 'react';
import { useBuffers, selectActive, type Encoding, type LineEnding } from '../stores/buffers';
import { EncodingPopover } from './EncodingPopover';
import { EolPopover } from './EolPopover';

function encodingLabel(e: Encoding): string {
  switch (e) {
    case 'utf-8': return 'UTF-8';
    case 'utf-8-bom': return 'UTF-8 BOM';
    case 'utf-16-le': return 'UTF-16 LE';
    case 'utf-16-be': return 'UTF-16 BE';
  }
}

function eolLabel(e: LineEnding): string {
  return e.toUpperCase();
}

function languageLabel(path: string | null): string {
  if (!path) return 'Plain';
  const ext = path.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    rs: 'Rust', js: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', tsx: 'TSX',
    json: 'JSON', md: 'Markdown', markdown: 'Markdown',
  };
  return map[ext] ?? 'Plain';
}

export function StatusBar() {
  const active = useBuffers(selectActive);
  const setActiveEncoding = useBuffers((s) => s.setActiveEncoding);
  const setActiveEol = useBuffers((s) => s.setActiveEol);

  const [encRect, setEncRect] = useState<DOMRect | null>(null);
  const [eolRect, setEolRect] = useState<DOMRect | null>(null);

  if (!active) {
    return <div className="h-6 border-t border-neutral-800 bg-neutral-900" />;
  }

  return (
    <div className="flex h-6 select-none items-center gap-3 border-t border-neutral-800 bg-neutral-900 px-3 text-[11px] text-neutral-400">
      <span data-status-segment="language">{languageLabel(active.path)}</span>

      <button
        type="button"
        data-status-segment="encoding"
        onClick={(e) => setEncRect(e.currentTarget.getBoundingClientRect())}
        className="hover:text-neutral-100"
      >
        {encodingLabel(active.encoding)}
      </button>

      <button
        type="button"
        data-status-segment="eol"
        onClick={(e) => setEolRect(e.currentTarget.getBoundingClientRect())}
        className="hover:text-neutral-100"
      >
        {eolLabel(active.eol)}
      </button>

      {encRect && (
        <EncodingPopover
          current={active.encoding}
          anchorRect={encRect}
          onSelect={setActiveEncoding}
          onClose={() => setEncRect(null)}
        />
      )}
      {eolRect && (
        <EolPopover
          current={active.eol}
          anchorRect={eolRect}
          onSelect={setActiveEol}
          onClose={() => setEolRect(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: TS check + commit**

```powershell
npx tsc --noEmit
git add src/components/EncodingPopover.tsx src/components/EolPopover.tsx src/components/StatusBar.tsx
git commit -m "ui(status): clickable encoding + EOL popovers (apply via store)"
```

---

## Task 13: New e2e specs — tabs, palette, status bar

**Files:**
- Create: `tests/e2e/tabs.spec.ts`
- Create: `tests/e2e/palette.spec.ts`
- Create: `tests/e2e/status-bar.spec.ts`

- [ ] **Step 1: Create tabs.spec.ts**

Create `tests/e2e/tabs.spec.ts`:

```ts
import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

interface BufferShim {
  __memopadTestReset?: () => void;
  __memopadTestNewBuffer?: () => string;
  __memopadTestOpenBuffer?: (file: { path: string; content: string; encoding: string; eol: string }) => string;
  __memopadTestCloseBuffer?: (id: string) => void;
  __memopadTestSwitchTo?: (id: string) => void;
  __memopadTestActiveId?: () => string | null;
  __memopadTestTabIds?: () => string[];
  __memopadTestRunCommand?: (id: string) => void;
}

async function exec<T>(fn: (w: BufferShim & typeof window) => T): Promise<T> {
  const browser = getBrowser();
  return browser.execute(fn);
}

describe('tabs', () => {
  beforeEach(async () => {
    await exec((w) => { w.__memopadTestReset!(); });
  });

  it('opening two files yields two tabs; activeId is the second', async () => {
    const ids = await exec((w) => [
      w.__memopadTestOpenBuffer!({ path: '/tmp/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' }),
      w.__memopadTestOpenBuffer!({ path: '/tmp/b.txt', content: 'B', encoding: 'utf-8', eol: 'lf' }),
    ]);
    const active = await exec((w) => w.__memopadTestActiveId!());
    expect(active).to.equal(ids[1]);
    const all = await exec((w) => w.__memopadTestTabIds!());
    expect(all).to.deep.equal(ids);
  });

  it('switchTo changes active without closing others', async () => {
    const [a, b] = await exec((w) => [
      w.__memopadTestOpenBuffer!({ path: '/tmp/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' }),
      w.__memopadTestOpenBuffer!({ path: '/tmp/b.txt', content: 'B', encoding: 'utf-8', eol: 'lf' }),
    ]);
    await exec((w) => { w.__memopadTestSwitchTo!(a); });
    expect(await exec((w) => w.__memopadTestActiveId!())).to.equal(a);
    expect(await exec((w) => w.__memopadTestTabIds!())).to.deep.equal([a, b]);
  });

  it('closing active tab focuses the next tab', async () => {
    const [a, b, c] = await exec((w) => [
      w.__memopadTestOpenBuffer!({ path: '/tmp/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' }),
      w.__memopadTestOpenBuffer!({ path: '/tmp/b.txt', content: 'B', encoding: 'utf-8', eol: 'lf' }),
      w.__memopadTestOpenBuffer!({ path: '/tmp/c.txt', content: 'C', encoding: 'utf-8', eol: 'lf' }),
    ]);
    // c is active; close it
    await exec((w) => { w.__memopadTestCloseBuffer!(c); });
    expect(await exec((w) => w.__memopadTestActiveId!())).to.equal(b);
    expect(await exec((w) => w.__memopadTestTabIds!())).to.deep.equal([a, b]);
  });

  it('Tab DOM reflects buffer order', async () => {
    await exec((w) => {
      w.__memopadTestOpenBuffer!({ path: '/tmp/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' });
      w.__memopadTestOpenBuffer!({ path: '/tmp/b.txt', content: 'B', encoding: 'utf-8', eol: 'lf' });
    });
    const tabNames = await classicExecute<string[]>(
      `return Array.from(document.querySelectorAll('[role="tab"]')).map(el => el.textContent.replace(/●/g,'').trim());`,
    );
    expect(tabNames).to.deep.equal(['a.txt', 'b.txt']);
  });

  it('Ctrl+W (via command) closes the active tab', async () => {
    const [a, b] = await exec((w) => [
      w.__memopadTestOpenBuffer!({ path: '/tmp/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' }),
      w.__memopadTestOpenBuffer!({ path: '/tmp/b.txt', content: 'B', encoding: 'utf-8', eol: 'lf' }),
    ]);
    await exec((w) => { w.__memopadTestRunCommand!('tab.close'); });
    expect(await exec((w) => w.__memopadTestTabIds!())).to.deep.equal([a]);
    expect(await exec((w) => w.__memopadTestActiveId!())).to.equal(a);
    void b;
  });

  it('Ctrl+Shift+T (via command) reopens the most recently closed tab', async () => {
    const [a, b] = await exec((w) => [
      w.__memopadTestOpenBuffer!({ path: '/tmp/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' }),
      w.__memopadTestOpenBuffer!({ path: '/tmp/b.txt', content: 'B', encoding: 'utf-8', eol: 'lf' }),
    ]);
    await exec((w) => { w.__memopadTestCloseBuffer!(b); });
    expect(await exec((w) => w.__memopadTestTabIds!())).to.deep.equal([a]);
    await exec((w) => { w.__memopadTestRunCommand!('tab.reopen'); });
    expect((await exec((w) => w.__memopadTestTabIds!())).length).to.equal(2);
  });
});
```

- [ ] **Step 2: Create palette.spec.ts**

Create `tests/e2e/palette.spec.ts`:

```ts
import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

describe('command palette', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      (window as unknown as { __memopadTestReset: () => void }).__memopadTestReset();
    });
  });

  it('opens with Ctrl+K and lists at least one command', async () => {
    await getBrowser().keys(['Control', 'k']);
    // give the modal a moment to mount
    await new Promise((r) => setTimeout(r, 250));
    const items = await classicExecute<string[]>(
      `return Array.from(document.querySelectorAll('[role="option"]')).map(el => el.textContent || '');`,
    );
    expect(items.length).to.be.greaterThan(0);
    expect(items.some((t) => t.includes('File: Open'))).to.equal(true);
    // close it
    await getBrowser().keys('Escape');
  });

  it('filters as you type', async () => {
    await getBrowser().keys(['Control', 'k']);
    await new Promise((r) => setTimeout(r, 250));
    await getBrowser().keys('reveal');
    await new Promise((r) => setTimeout(r, 150));
    const items = await classicExecute<string[]>(
      `return Array.from(document.querySelectorAll('[role="option"]')).map(el => el.textContent || '');`,
    );
    expect(items.length).to.be.greaterThan(0);
    expect(items.every((t) => t.toLowerCase().includes('reveal'))).to.equal(true);
    await getBrowser().keys('Escape');
  });

  it('runCommand bypass — file.new creates a new untitled tab', async () => {
    await exec(() => {
      (window as unknown as { __memopadTestRunCommand: (id: string) => void }).__memopadTestRunCommand('file.new');
    });
    const count = await exec(() => {
      const f = (window as unknown as { __memopadTestTabIds: () => string[] }).__memopadTestTabIds;
      return f().length;
    });
    expect(count).to.equal(1);
  });
});
```

- [ ] **Step 3: Create status-bar.spec.ts**

Create `tests/e2e/status-bar.spec.ts`:

```ts
import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

describe('status bar', () => {
  beforeEach(async () => {
    await exec(() => {
      const w = window as unknown as { __memopadTestReset: () => void };
      w.__memopadTestReset();
    });
  });

  it('shows nothing useful when no buffer is open', async () => {
    const txt = await classicExecute<string>(
      `var el = document.querySelector('[data-status-segment="encoding"]'); return el ? el.textContent : 'NONE';`,
    );
    expect(txt).to.equal('NONE');
  });

  it('shows UTF-8 / LF for a fresh untitled buffer', async () => {
    await exec(() => {
      const w = window as unknown as { __memopadTestNewBuffer: () => string };
      w.__memopadTestNewBuffer();
    });
    const enc = await classicExecute<string>(
      `return document.querySelector('[data-status-segment="encoding"]').textContent;`,
    );
    const eol = await classicExecute<string>(
      `return document.querySelector('[data-status-segment="eol"]').textContent;`,
    );
    expect(enc).to.equal('UTF-8');
    expect(eol).to.equal('LF');
  });

  it('reflects encoding from opened file', async () => {
    await exec(() => {
      const w = window as unknown as {
        __memopadTestOpenBuffer: (f: { path: string; content: string; encoding: string; eol: string }) => string;
      };
      w.__memopadTestOpenBuffer({ path: '/tmp/x.txt', content: 'hi', encoding: 'utf-16-le', eol: 'crlf' });
    });
    const enc = await classicExecute<string>(
      `return document.querySelector('[data-status-segment="encoding"]').textContent;`,
    );
    const eol = await classicExecute<string>(
      `return document.querySelector('[data-status-segment="eol"]').textContent;`,
    );
    expect(enc).to.equal('UTF-16 LE');
    expect(eol).to.equal('CRLF');
  });
});
```

- [ ] **Step 4: Run the full e2e suite**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Get-Process | Where-Object { $_.ProcessName -match '^(tauri-driver|msedgedriver|app)$' } | Stop-Process -Force -ErrorAction SilentlyContinue
npm run test:e2e
Get-Process | Where-Object { $_.ProcessName -match '^(tauri-driver|msedgedriver|app)$' } | Stop-Process -Force -ErrorAction SilentlyContinue
```

Expected: existing 11 specs still pass + 6 new (tabs) + 3 new (palette) + 3 new (status bar) = **23 passing**.

If any flake, give that test one retry (rare timing issue with palette modal mount); if it consistently fails, debug in helpers/driver before pressing on.

- [ ] **Step 5: Commit**

```powershell
git add tests/e2e/tabs.spec.ts tests/e2e/palette.spec.ts tests/e2e/status-bar.spec.ts
git commit -m "test(e2e): tabs, palette, status-bar specs (23 e2e tests total)"
```

---

## Task 14: Build, full smoke, results doc

**Files:**
- Create: `docs/superpowers/plans/phase-3-results.md`

- [ ] **Step 1: Run every automated gate**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm test
Set-Location src-tauri
cargo test
Set-Location ..
npx tsc --noEmit
Get-Process | Where-Object { $_.ProcessName -match '^(tauri-driver|msedgedriver|app)$' } | Stop-Process -Force -ErrorAction SilentlyContinue
npm run test:e2e
Get-Process | Where-Object { $_.ProcessName -match '^(tauri-driver|msedgedriver|app)$' } | Stop-Process -Force -ErrorAction SilentlyContinue
```

Expected:
- Vitest: 22 passing (1 sanity + 13 buffers + 3 tauri + 5 commands)
- cargo: 29 passing (unchanged)
- tsc: exit 0
- e2e: 23 passing

- [ ] **Step 2: Produce a fresh release MSI**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri build
```

Record:
- MSI size
- app.exe size
- Build wall-clock

- [ ] **Step 3: Create the results doc**

Create `docs/superpowers/plans/phase-3-results.md`:

```markdown
# Phase 3 — Results

## Automated test gates

- Vitest: 22 tests passing (was 10)
- cargo test (fs): 29 tests passing (unchanged)
- e2e (WebdriverIO): 23 tests passing (was 11)
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: __ MB (Phase 2 baseline 3.91 MB)
- app.exe size: __ MB (Phase 2 baseline 9.74 MB)
- Build wall-clock: __ minutes (warm cache)

## New surface

- Multi-buffer store with tab order + recently-closed stack
- TabStrip in the title bar: drag-reorder, middle-click close, right-click context menu
- StatusBar with clickable encoding + EOL popovers
- Command palette (Ctrl+K / Ctrl+Shift+P) with fuzzy search + recent-first ordering
- New IPC: reveal_in_explorer
- New keybindings: Ctrl+N (new), Ctrl+W (close), Ctrl+Shift+T (reopen), Ctrl+Tab / Ctrl+Shift+Tab (switch)

## Known follow-ups for Phase 4

- Per-tab cursor position (currently CodeMirror remounts on tab switch)
- Session restore (reopen the same tabs on relaunch) — Phase 4
- Crash recovery journal — Phase 4
- External-change detection — Phase 4
- Encoding change in status bar marks dirty but doesn't re-encode the buffer's
  original content; saving and reopening will round-trip through the new
  encoding, which is correct for v1 but worth revisiting if a user expects
  "preview-then-apply" semantics.
```

- [ ] **Step 4: Commit**

```powershell
git add docs/superpowers/plans/phase-3-results.md
git commit -m "phase 3: record results"
```

---

## Phase 3 Acceptance

Close Phase 3 when:

1. `npm test` → 22 passing
2. `cargo test` → 29 passing
3. `npm run test:e2e` → 23 passing
4. `npx tsc --noEmit` → exit 0
5. `npm run tauri build` produces an MSI
6. Manual sanity: launch, Ctrl+O two files, Ctrl+Tab between them, Ctrl+W closes, Ctrl+Shift+T reopens, Ctrl+K opens palette, click status bar segments to change encoding/EOL.

## What is intentionally NOT in this phase

- Per-tab cursor / scroll position — Phase 4
- Session restore — Phase 4
- Crash-recovery journal — Phase 4
- External change detection — Phase 4
- Find / replace — Phase 5
- Themes other than One Dark — Phase 5
- Indent display + click-to-change — deferred (covered by spec but pushed since cursor display itself is deferred)
- Cursor position segment in status bar — deferred with above
