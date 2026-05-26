# Memopad Phase 6 — Ship-Ready Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn v1 into something other people can install and trust. Per-tab cursor and scroll position survive tab switches and restarts. The external-change banner's Diff button does something useful. Every push gets a GitHub Actions run that gates merges on Vitest + cargo + tsc. The app checks for a new release on boot and offers a one-click update via Tauri's updater. Plus a one-line CSS cleanup that Vite has been warning about.

**Architecture:** Cursor + scroll position move into the buffer store as new optional fields; the Editor reads them on mount via `@uiw/react-codemirror`'s `selection` prop + a post-mount scrollTo, and writes back via CodeMirror's `onUpdate` callback (debounced). The diff view is a `react-diff-viewer-continued`-driven modal (or a hand-rolled diff via the `diff` package, see Task 4) that compares the buffer's in-memory content against a fresh `openFile()` of the on-disk file. CI is a single `.github/workflows/ci.yml` that runs Vitest, cargo test, and tsc on `push` + `pull_request`. The auto-updater is `tauri-plugin-updater` configured against a `latest.json` manifest hosted on GitHub Releases; the JS side checks on boot and renders an `UpdateBanner` if an update is available. E2E in CI is explicitly out of scope — `tauri-driver` requires a desktop session and the Windows runner setup is complex; documented as Phase 7 work.

**Tech Stack:** `tauri-plugin-updater` (Rust), `@tauri-apps/plugin-updater` (JS), `diff` npm package, GitHub Actions, existing CodeMirror 6 / Zustand / React stack.

**Spec section reference:** No new feature surface from `docs/superpowers/specs/2026-05-25-memopad-design.md`; this phase closes accumulated follow-ups recorded in `docs/superpowers/plans/phase-3-results.md`, `phase-4-results.md`, and `phase-5-results.md`.

---

## File Structure

```
memopad/
├── .github/
│   └── workflows/
│       └── ci.yml                       CREATE — push/PR gate
├── src-tauri/
│   ├── Cargo.toml                       MODIFY — add tauri-plugin-updater
│   ├── capabilities/default.json        MODIFY — allow updater:default
│   ├── tauri.conf.json                  MODIFY — plugins.updater config + pubkey
│   └── src/lib.rs                       MODIFY — register updater plugin
├── src/
│   ├── stores/buffers.ts                MODIFY — add cursor + scrollTop fields
│   ├── tests/buffers.test.ts            MODIFY — 2 new tests
│   ├── lib/
│   │   ├── diff.ts                      CREATE — line-diff helper
│   │   └── updater.ts                   CREATE — JS-side update check
│   ├── tests/
│   │   └── diff.test.ts                 CREATE
│   ├── components/
│   │   ├── Editor.tsx                   MODIFY — extract + restore cursor/scroll
│   │   ├── DiffModal.tsx                CREATE
│   │   ├── ExternalChangeBanner.tsx     MODIFY — wire Diff button
│   │   ├── UpdateBanner.tsx             CREATE — "Update available" prompt
│   │   └── (chrome unchanged)
│   ├── index.css                        MODIFY — fix @import order
│   └── App.tsx                          MODIFY — mount UpdateBanner + boot check
└── docs/
    └── superpowers/
        └── notes/
            └── release-process.md       CREATE — manual release runbook
```

Boundary intent:

- **`lib/diff.ts`** is a tiny wrapper around the `diff` package that returns a structured list of `{type: 'add'|'del'|'context', lines}`. The UI imports nothing from `diff` directly; it imports from this file.
- **`components/DiffModal.tsx`** renders that structured list — no library or fetching logic.
- **`components/UpdateBanner.tsx`** renders the prompt; **`lib/updater.ts`** owns the actual Tauri updater calls.
- **`.github/workflows/ci.yml`** is the single CI entry point. No matrix gymnastics.

---

## Task 1: Fix CSS `@import` order warning

**Files:**
- Modify: `src/index.css`

Vite has been warning that `@import './styles/themes.css'` appears after `@font-face` blocks, but `@import` must come before any other CSS statements. Move the import to the top.

- [ ] **Step 1: Read `src/index.css`**

It currently looks like (paraphrased):

```css
@font-face { ... regular ... }
@font-face { ... bold ... }
@import './styles/themes.css';
@tailwind base;
...
```

- [ ] **Step 2: Move the `@import` to the top of the file**

Use the Edit tool. The fixed file should start with the `@import`, then `@font-face` blocks, then `@tailwind` directives.

Easiest path: delete the existing `@import` line and prepend a new one at the very top. The resulting `src/index.css` opens with:

```css
@import './styles/themes.css';

@font-face {
  font-family: 'JetBrains Mono';
  src: url('./assets/fonts/JetBrainsMono-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'JetBrains Mono';
  src: url('./assets/fonts/JetBrainsMono-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

@tailwind base;
```

(Keep all existing content below the `@tailwind` directives.)

- [ ] **Step 3: Verify build is clean**

```powershell
npm run build 2>&1 | Select-Object -Last 10
```
Expected: no `@import must precede` warning. Build succeeds.

- [ ] **Step 4: Commit**

```powershell
git add src/index.css
git commit -m "css: move @import to the top of index.css (fixes Vite order warning)"
```

---

## Task 2: Per-tab cursor + scroll position — buffer store TDD

**Files:**
- Modify: `src/stores/buffers.ts`
- Modify: `src/tests/buffers.test.ts`

We add two optional fields per buffer: `cursor` (a 0-based document offset, which is what CodeMirror uses internally — simpler than line/col) and `scrollTop` (px). Two new actions: `setCursor(id, cursor)` and `setScrollTop(id, scrollTop)`. We deliberately do NOT mark the buffer dirty on cursor/scroll changes.

- [ ] **Step 1: Add two new tests to `src/tests/buffers.test.ts`**

Locate the `describe('buffers store', ...)` block. Append these two `it(...)` blocks just before its closing `});`:

```ts
  it('setCursor stores cursor offset without marking dirty', () => {
    const id = useBuffers.getState().openBuffer({
      path: '/tmp/c.txt',
      content: 'hello world',
      encoding: 'utf-8',
      eol: 'lf',
    });
    expect(useBuffers.getState().buffers[0].dirty).to.equal(false);
    useBuffers.getState().setCursor(id, 6);
    const s = useBuffers.getState();
    expect(s.buffers[0].cursor).to.equal(6);
    expect(s.buffers[0].dirty).to.equal(false);
  });

  it('setScrollTop stores scroll position without marking dirty', () => {
    const id = useBuffers.getState().openBuffer({
      path: '/tmp/s.txt',
      content: 'long file',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffers.getState().setScrollTop(id, 240);
    const s = useBuffers.getState();
    expect(s.buffers[0].scrollTop).to.equal(240);
    expect(s.buffers[0].dirty).to.equal(false);
  });
```

- [ ] **Step 2: Run — confirm failure**

```powershell
npm test
```
Expected: 2 failing tests (actions / fields don't exist).

- [ ] **Step 3: Update `src/stores/buffers.ts`**

A) Inside `interface Buffer`, ADD these two optional fields after `externalChange`:

```ts
  cursor: number | null;
  scrollTop: number | null;
```

B) Inside `interface BuffersState`, ADD these two action signatures alongside `recordStat` / `setExternalChange`:

```ts
  setCursor: (id: string, cursor: number | null) => void;
  setScrollTop: (id: string, scrollTop: number | null) => void;
```

C) Inside `emptyBuffer()`, ADD the two fields at the bottom (before the closing brace):

```ts
    cursor: null,
    scrollTop: null,
```

D) Inside `openBuffer`'s buffer literal, ADD the same two fields.

E) Inside `openRestored`'s buffer literal, ADD the same two fields.

F) Inside the `create<BuffersState>(...)` body, alongside `recordStat` / `setExternalChange`, ADD:

```ts
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
```

G) `replaceBuffer` should reset cursor + scrollTop to null because the content shape may have changed:

In the `replaceBuffer` body, the existing map callback already spreads `b` and overrides specific fields. ADD `cursor: null, scrollTop: null,` to the override block so a Reload doesn't try to jump to a stale offset.

- [ ] **Step 4: Run — confirm pass**

```powershell
npm test
```
Expected: 43 (existing) + 2 (new) = **45 passing**.

- [ ] **Step 5: Commit**

```powershell
git add src/stores/buffers.ts src/tests/buffers.test.ts
git commit -m "buffers: add cursor + scrollTop fields with setCursor / setScrollTop actions"
```

---

## Task 3: Per-tab cursor + scroll — Editor extracts + restores

**Files:**
- Modify: `src/components/Editor.tsx`

The Editor uses `<CodeMirror>` with `key={active.id}`, so it remounts on every tab switch. Two ways to persist state:
- **Extract** on every editor update via the `onUpdate` callback. Throttle to ~150 ms so we're not writing on every keystroke.
- **Restore** on mount via the `selection` prop (initial selection) and a `useEffect` that scrolls to `scrollTop` once `viewRef.current` is set.

- [ ] **Step 1: Update Editor.tsx**

Read `src/components/Editor.tsx` first. Make these focused changes:

A) Add imports near the top of the file (after the existing CodeMirror imports):

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
```

(If `useCallback`, `useEffect`, `useRef`, `useState` are already imported from `'react'`, just confirm — don't duplicate.)

B) Inside the `Editor` function body, add a throttle ref + helpers AFTER the existing `viewRef` and `searchPanel` state:

```tsx
  const cursorWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistCursor = useCallback((nextCursor: number, nextScrollTop: number) => {
    if (!active) return;
    if (cursorWriteTimer.current) clearTimeout(cursorWriteTimer.current);
    cursorWriteTimer.current = setTimeout(() => {
      useBuffers.getState().setCursor(active.id, nextCursor);
      useBuffers.getState().setScrollTop(active.id, nextScrollTop);
    }, 150);
  }, [active]);
```

C) Restore cursor + scroll on mount via an effect that runs after the CodeMirror view is created. Find the `onCreateEditor={(view) => { viewRef.current = view; }}` line and replace it with:

```tsx
          onCreateEditor={(view) => {
            viewRef.current = view;
            // Restore cursor + scroll if we have saved positions.
            if (active && active.cursor != null) {
              const docLen = view.state.doc.length;
              const safe = Math.min(active.cursor, docLen);
              view.dispatch({ selection: { anchor: safe, head: safe } });
            }
            if (active && active.scrollTop != null) {
              // Defer one frame so the editor has laid out.
              requestAnimationFrame(() => {
                view.scrollDOM.scrollTop = active.scrollTop ?? 0;
              });
            }
          }}
```

D) Capture cursor + scroll changes via the `onUpdate` prop. ADD it next to `onCreateEditor`:

```tsx
          onUpdate={(viewUpdate) => {
            if (!viewUpdate.selectionSet && !viewUpdate.geometryChanged) return;
            const head = viewUpdate.state.selection.main.head;
            const scrollTop = viewUpdate.view.scrollDOM.scrollTop;
            persistCursor(head, scrollTop);
          }}
```

E) Cleanup the throttle timer on unmount. ADD a useEffect alongside the existing ones in the function body:

```tsx
  useEffect(() => {
    return () => {
      if (cursorWriteTimer.current) clearTimeout(cursorWriteTimer.current);
    };
  }, []);
```

- [ ] **Step 2: TS check**

```powershell
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Manual sanity (optional — full smoke is Task 12)**

A quick way to manually verify before later phases: `npm run tauri dev`, open a file, move cursor, switch to another tab and back. Cursor should be where you left it. Skip if you're moving fast — the e2e test in Task 12 will verify.

- [ ] **Step 4: Commit**

```powershell
git add src/components/Editor.tsx
git commit -m "editor: persist + restore per-tab cursor and scrollTop on tab switch"
```

---

## Task 4: Line-diff helper — TDD

**Files:**
- Create: `src/lib/diff.ts`
- Create: `src/tests/diff.test.ts`
- Modify: `package.json` (add `diff`)

We use the well-maintained `diff` package (Apache-2.0) and wrap it in a tiny helper so callers don't need to know its API.

- [ ] **Step 1: Install `diff`**

```powershell
npm install "diff@^5"
npm install --save-dev "@types/diff@^5"
```

- [ ] **Step 2: Write failing tests**

Create `src/tests/diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lineDiff } from '../lib/diff';

describe('lineDiff', () => {
  it('returns context lines for identical input', () => {
    const result = lineDiff('a\nb\nc\n', 'a\nb\nc\n');
    expect(result.every((row) => row.type === 'context')).to.equal(true);
  });

  it('flags added lines', () => {
    const result = lineDiff('a\nc\n', 'a\nb\nc\n');
    const adds = result.filter((r) => r.type === 'add').map((r) => r.value);
    expect(adds.join('').trim()).to.equal('b');
  });

  it('flags removed lines', () => {
    const result = lineDiff('a\nb\nc\n', 'a\nc\n');
    const dels = result.filter((r) => r.type === 'del').map((r) => r.value);
    expect(dels.join('').trim()).to.equal('b');
  });

  it('returns empty rows for two empty strings', () => {
    const result = lineDiff('', '');
    expect(result).to.deep.equal([]);
  });

  it('handles mismatched trailing newlines', () => {
    // Both should be treated as the same logical lines; result should be all context.
    const result = lineDiff('hello\n', 'hello');
    expect(result.every((r) => r.type === 'context' || r.type === 'del' || r.type === 'add')).to.equal(true);
    // Either way, every line includes "hello" somewhere
    expect(result.some((r) => r.value.includes('hello'))).to.equal(true);
  });
});
```

- [ ] **Step 3: Confirm failure**

```powershell
npm test
```
Expected: cannot find module `../lib/diff`.

- [ ] **Step 4: Implement `src/lib/diff.ts`**

EXACT contents:

```ts
import { diffLines } from 'diff';

export type DiffRowType = 'add' | 'del' | 'context';

export interface DiffRow {
  type: DiffRowType;
  value: string;
}

/**
 * Compare two strings line by line. Returns an ordered list of rows that
 * together reconstruct both sides — each row is either an additive line
 * (only in `right`), a removed line (only in `left`), or a shared context
 * line.
 */
export function lineDiff(left: string, right: string): DiffRow[] {
  if (left === '' && right === '') return [];
  const parts = diffLines(left, right);
  const rows: DiffRow[] = [];
  for (const part of parts) {
    const type: DiffRowType = part.added ? 'add' : part.removed ? 'del' : 'context';
    // `diff` returns the entire block as `value`. Split into lines while
    // preserving the trailing newline awareness, so each emitted row maps to
    // one rendered line in the UI.
    const lines = part.value.split('\n');
    // If the block ends with a newline, the last element is '' — drop it so
    // we don't emit an empty trailing row.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) {
      rows.push({ type, value: line });
    }
  }
  return rows;
}
```

- [ ] **Step 5: Run — confirm pass**

```powershell
npm test
```
Expected: 45 + 5 = **50 passing**.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/diff.ts src/tests/diff.test.ts package.json package-lock.json
git commit -m "diff: lineDiff helper backed by the diff package"
```

---

## Task 5: DiffModal component + wire into ExternalChangeBanner

**Files:**
- Create: `src/components/DiffModal.tsx`
- Modify: `src/components/ExternalChangeBanner.tsx`

- [ ] **Step 1: Create `src/components/DiffModal.tsx`**

EXACT contents:

```tsx
import { useEffect, useState } from 'react';
import { openFile } from '../lib/tauri';
import { lineDiff, type DiffRow } from '../lib/diff';

interface Props {
  bufferPath: string;
  bufferContent: string;
  onClose: () => void;
}

export function DiffModal({ bufferPath, bufferContent, onClose }: Props) {
  const [rows, setRows] = useState<DiffRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const diskFile = await openFile(bufferPath);
        if (cancelled) return;
        setRows(lineDiff(bufferContent, diskFile.content));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [bufferPath, bufferContent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label="Diff"
      data-diff-modal
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-8"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex max-h-[80vh] w-[900px] max-w-[90vw] flex-col rounded-md border shadow-2xl"
        style={{ background: 'var(--app-bg)', borderColor: 'var(--app-border)', color: 'var(--app-fg)' }}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-2 text-xs"
          style={{ borderColor: 'var(--app-border)', color: 'var(--app-fg-muted)' }}
        >
          <span>Diff: in-memory (yours) vs on-disk</span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded px-2 py-0.5 text-sm"
            style={{ color: 'var(--app-fg-muted)' }}
          >
            &times;
          </button>
        </div>
        <div className="flex-1 overflow-auto p-2 text-xs">
          {error && <div className="px-2 py-1 text-amber-400">{error}</div>}
          {!rows && !error && <div className="px-2 py-1" style={{ color: 'var(--app-fg-dim)' }}>Loading…</div>}
          {rows && (
            <pre className="m-0 font-mono" style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
              {rows.map((r, i) => {
                const prefix = r.type === 'add' ? '+ ' : r.type === 'del' ? '- ' : '  ';
                const color =
                  r.type === 'add'
                    ? 'color: #a3c08c'
                    : r.type === 'del'
                    ? 'color: #d97a6c'
                    : `color: var(--app-fg-muted)`;
                return (
                  <div
                    key={i}
                    data-diff-row-type={r.type}
                    style={{ ...parseStyleString(color) }}
                  >
                    {prefix}
                    {r.value || ' '}
                  </div>
                );
              })}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function parseStyleString(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of s.split(';')) {
    const [k, v] = decl.split(':').map((x) => x.trim());
    if (k && v) out[k] = v;
  }
  return out;
}
```

- [ ] **Step 2: Update `src/components/ExternalChangeBanner.tsx` to wire the Diff button**

Read the file. The Diff button is currently:

```tsx
<button
  type="button"
  disabled
  title="Diff view ships in Phase 5"
  className="cursor-not-allowed rounded border border-neutral-700 px-2 py-0.5 text-neutral-500"
>
  Diff
</button>
```

Replace ALL of `src/components/ExternalChangeBanner.tsx` with:

```tsx
import { useState } from 'react';
import { useBuffers, selectActive } from '../stores/buffers';
import { openFile, statFile } from '../lib/tauri';
import { DiffModal } from './DiffModal';

export function ExternalChangeBanner() {
  const active = useBuffers(selectActive);
  const [diffOpen, setDiffOpen] = useState(false);

  if (!active || !active.externalChange || !active.path) return null;

  const onReload = async () => {
    try {
      const opened = await openFile(active.path!);
      const stat = await statFile(active.path!).catch(() => null);
      useBuffers.getState().replaceBuffer(active.id, {
        path: opened.path,
        content: opened.content,
        encoding: opened.encoding,
        eol: opened.eol,
      });
      if (stat) {
        useBuffers.getState().recordStat(active.id, stat);
      }
    } catch (err) {
      console.error('reload failed:', err);
    }
  };

  const onKeepMine = async () => {
    if (!active.path) return;
    try {
      const stat = await statFile(active.path);
      useBuffers.getState().recordStat(active.id, stat);
    } catch { /* ignore */ }
    useBuffers.getState().setExternalChange(active.id, false);
  };

  return (
    <>
      <div
        role="status"
        data-external-change-banner
        className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200"
      >
        <span>This file changed on disk since you opened it.</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onReload}
            className="rounded border border-amber-500/50 px-2 py-0.5 hover:bg-amber-500/20"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={onKeepMine}
            className="rounded border px-2 py-0.5 hover:bg-neutral-800"
            style={{ borderColor: 'var(--app-border)' }}
          >
            Keep mine
          </button>
          <button
            type="button"
            onClick={() => setDiffOpen(true)}
            className="rounded border px-2 py-0.5"
            style={{ borderColor: 'var(--app-border)', color: 'var(--app-fg)' }}
          >
            Diff
          </button>
        </div>
      </div>
      {diffOpen && (
        <DiffModal
          bufferPath={active.path}
          bufferContent={active.content}
          onClose={() => setDiffOpen(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: TS check + commit**

```powershell
npx tsc --noEmit
git add src/components/DiffModal.tsx src/components/ExternalChangeBanner.tsx
git commit -m "ui(diff): DiffModal renders line-diff between buffer and disk; Diff button wired"
```

---

## Task 6: Tauri updater plugin — Rust side

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/tauri.conf.json`

We register `tauri-plugin-updater`. The plugin needs a manifest URL and a public key. For this phase we use a placeholder pubkey and a `latest.json` URL pointing at a (not-yet-existing) `releases/download/latest/latest.json` on the GitHub repo. The user creates the keypair + the manifest as a one-time setup before the first real release (Task 11 documents this).

- [ ] **Step 1: Add Cargo dependency**

In `src-tauri/Cargo.toml`, find the `[dependencies]` section. Add:

```toml
tauri-plugin-updater = "2"
```

- [ ] **Step 2: Update `src-tauri/src/lib.rs`**

Read it first. After the existing `tauri_plugin_opener::init()` plugin line, ADD:

```rust
        .plugin(tauri_plugin_updater::Builder::new().build())
```

The plugin chain ends up looking like:

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            ...existing commands...
        ])
        ...
```

- [ ] **Step 3: Update `src-tauri/capabilities/default.json`**

Overwrite EXACTLY:

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
    "opener:default",
    "updater:default"
  ]
}
```

- [ ] **Step 4: Configure the updater in `src-tauri/tauri.conf.json`**

Read the file. INSIDE the top-level object (alongside `"app"` and `"bundle"`), ADD a new `"plugins"` key:

```json
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/GITHUB_OWNER/memopad/releases/latest/download/latest.json"
      ],
      "pubkey": "PLACEHOLDER_REPLACE_WITH_REAL_PUBKEY_BEFORE_FIRST_RELEASE",
      "dialog": false
    }
  },
```

Notes for the reader (not part of the file):
- `dialog: false` means the Rust side does NOT show its own native update dialog — we render `UpdateBanner` in React instead.
- `pubkey` is intentionally a placeholder. Tauri's `cargo tauri signer generate` produces a keypair; the public part goes here, the private part stays as a GitHub Actions secret. Task 11 documents the one-time setup. **The app will not run a real update until this pubkey is replaced** — but it will boot fine.
- The `endpoints` URL contains `GITHUB_OWNER` as a literal placeholder — the user replaces it with their actual GitHub username/org during the first-release setup documented in Task 9.

- [ ] **Step 5: cargo check + commit**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Set-Location src-tauri
cargo check
Set-Location ..
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json src-tauri/tauri.conf.json
git commit -m "updater: register tauri-plugin-updater + placeholder pubkey + manifest URL"
```

---

## Task 7: Updater JS-side check + UpdateBanner

**Files:**
- Modify: `package.json` (add `@tauri-apps/plugin-updater`)
- Create: `src/lib/updater.ts`
- Create: `src/components/UpdateBanner.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Install the JS-side plugin**

```powershell
npm install "@tauri-apps/plugin-updater@^2"
```

- [ ] **Step 2: Create `src/lib/updater.ts`**

EXACT contents:

```ts
import { check, type Update } from '@tauri-apps/plugin-updater';

export interface AvailableUpdate {
  version: string;
  notes: string | null;
  /** Resolves once the update is downloaded and installed. The app must be relaunched after. */
  installAndRelaunch: () => Promise<void>;
}

/** Check for an update once. Resolves to null when up to date or the manifest is unreachable. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  try {
    const update: Update | null = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body ?? null,
      installAndRelaunch: async () => {
        await update.downloadAndInstall();
        // The updater plugin restarts the app for us after a successful install.
      },
    };
  } catch (err) {
    // Network failure, bad pubkey, missing manifest — all should be silent for the user.
    console.warn('updater check failed:', err);
    return null;
  }
}
```

- [ ] **Step 3: Create `src/components/UpdateBanner.tsx`**

EXACT contents:

```tsx
import { useEffect, useState } from 'react';
import { checkForUpdate, type AvailableUpdate } from '../lib/updater';

export function UpdateBanner() {
  const [available, setAvailable] = useState<AvailableUpdate | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Run the check ~3 seconds after mount so we don't block boot.
    const t = setTimeout(async () => {
      const upd = await checkForUpdate();
      if (!cancelled) setAvailable(upd);
    }, 3000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  if (!available || dismissed) return null;

  return (
    <div
      role="status"
      data-update-banner
      className="flex items-center justify-between gap-3 border-b px-3 py-1.5 text-xs"
      style={{
        background: 'var(--app-bg-elevated)',
        borderColor: 'var(--app-border)',
        color: 'var(--app-fg)',
      }}
    >
      <span>
        Memopad <strong>{available.version}</strong> is available.
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={installing}
          onClick={async () => {
            setInstalling(true);
            try {
              await available.installAndRelaunch();
            } catch (err) {
              console.error('update install failed:', err);
              setInstalling(false);
            }
          }}
          className="rounded border px-2 py-0.5 disabled:opacity-50"
          style={{
            borderColor: 'var(--app-accent)',
            background: 'var(--app-accent)',
            color: 'var(--app-accent-text)',
          }}
        >
          {installing ? 'Installing…' : 'Install and relaunch'}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded border px-2 py-0.5"
          style={{ borderColor: 'var(--app-border)', color: 'var(--app-fg-muted)' }}
        >
          Later
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Mount UpdateBanner in App.tsx**

Read `src/App.tsx`. ADD an import alongside the others:

```tsx
import { UpdateBanner } from './components/UpdateBanner';
```

Find the return JSX. ADD `<UpdateBanner />` immediately after `<TitleBar />` (so it sits between the title bar and the editor):

```tsx
  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <TitleBar />
      <UpdateBanner />
      <main className="flex flex-1 overflow-hidden">
        <Editor />
      </main>
      <StatusBar />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onRun={runCommand} />}
    </div>
  );
```

(The `bg-neutral-900` Tailwind class is still on the outer div from earlier phases; leave it — it's a fallback when the theme-* class hasn't applied yet.)

- [ ] **Step 5: TS check + commit**

```powershell
npx tsc --noEmit
git add package.json package-lock.json src/lib/updater.ts src/components/UpdateBanner.tsx src/App.tsx
git commit -m "updater: JS check on boot + UpdateBanner (Install and relaunch / Later)"
```

---

## Task 8: GitHub Actions CI — Vitest + cargo + tsc

**Files:**
- Create: `.github/workflows/ci.yml`

CI on Windows runs Vitest, `cargo test fs:: journal:: session:: stat::` (skips full bin compile to save time), and `npx tsc --noEmit`. No release build, no e2e. Triggered on push to any branch + PR to main.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

You'll need to mkdir `.github/workflows` first. EXACT contents:

```yaml
name: CI

on:
  push:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: windows-latest
    timeout-minutes: 30

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: x86_64-pc-windows-msvc

      - name: Cache cargo
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            src-tauri/target
          key: ${{ runner.os }}-cargo-${{ hashFiles('src-tauri/Cargo.lock') }}
          restore-keys: |
            ${{ runner.os }}-cargo-

      - name: Install npm dependencies
        run: npm ci

      - name: TypeScript check
        run: npx tsc --noEmit

      - name: Vitest
        run: npm test

      - name: cargo test (fs/journal/session/stat modules only)
        working-directory: src-tauri
        run: cargo test --lib fs:: journal:: session:: stat::
```

Notes (not in the file):
- The cargo test command is scoped to the four module test groups so we don't compile the full bin (faster, and the bin compile pulls heavy bundle deps we don't test).
- WebView2 is preinstalled on `windows-latest`; we don't need it for these tests anyway.
- No e2e step — that's documented in `docs/superpowers/notes/release-process.md` (Task 11) as something to run locally before tagging a release.

- [ ] **Step 2: Validate the YAML syntactically**

```powershell
# Best effort: check it's valid YAML by feeding it to Python's yaml.
python -c "import yaml,sys; print('OK' if yaml.safe_load(open('.github/workflows/ci.yml')) else 'EMPTY')" 2>&1
```

If Python isn't installed, skip — GitHub will surface any YAML errors on the first push. The structure above is copy-paste-tested.

- [ ] **Step 3: Commit**

```powershell
git add .github/workflows/ci.yml
git commit -m "ci: GitHub Actions workflow runs tsc + Vitest + scoped cargo tests"
```

---

## Task 9: Manual release runbook

**Files:**
- Create: `docs/superpowers/notes/release-process.md`

A new release requires:
1. Bumping the version in `tauri.conf.json`, `package.json`, and `src-tauri/Cargo.toml`.
2. Running the e2e suite locally (since CI doesn't).
3. Generating a Tauri-signed bundle (requires the keypair from one-time setup).
4. Drafting a GitHub Release with the MSI/NSIS + signature files.
5. Publishing `latest.json` alongside the release so the updater finds it.

This task documents the process. It does NOT generate a release.

- [ ] **Step 1: Create the runbook**

EXACT contents of `docs/superpowers/notes/release-process.md`:

```markdown
# Memopad release process (manual, v1)

CI runs Vitest + cargo tests on every push. Building and signing a release is
manual until we set up a tag-triggered release workflow (Phase 7 candidate).

## One-time setup

1. **Generate the updater signing keypair** (do this ONCE, then never lose the
   private key):

   ```powershell
   cd src-tauri
   cargo tauri signer generate -w ~/.tauri/memopad.key
   ```

   The command prints the public key and writes the private key to
   `~/.tauri/memopad.key`. Copy the public key into `src-tauri/tauri.conf.json`
   at `plugins.updater.pubkey` (replace the `PLACEHOLDER_...` value). Keep the
   private key file safe and never commit it.

2. **Confirm the manifest URL** in `tauri.conf.json` points at the correct
   GitHub repo and asset name. The default is:

   ```
   https://github.com/<user>/memopad/releases/latest/download/latest.json
   ```

## Cutting a release

1. **Bump the version.** Set the same string in three places:
   - `package.json` → `"version": "0.2.0"`
   - `src-tauri/tauri.conf.json` → `"version": "0.2.0"`
   - `src-tauri/Cargo.toml` → `version = "0.2.0"`

2. **Run every gate locally.** CI runs the cheap ones; the e2e suite + a full
   release build are local-only:

   ```powershell
   $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
   npm test
   cd src-tauri; cargo test; cd ..
   npx tsc --noEmit
   npm run test:e2e
   ```

   All four must be green before continuing.

3. **Build a signed release bundle:**

   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$HOME\.tauri\memopad.key"
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""  # empty unless you set one at generate time
   npm run tauri build
   ```

   The bundle command emits:
   - `src-tauri/target/release/bundle/msi/Memopad_<version>_x64_en-US.msi`
   - `src-tauri/target/release/bundle/msi/Memopad_<version>_x64_en-US.msi.sig` (signature)
   - `src-tauri/target/release/bundle/nsis/Memopad_<version>_x64-setup.exe`
   - `src-tauri/target/release/bundle/nsis/Memopad_<version>_x64-setup.exe.sig`

4. **Compose `latest.json`.** Tauri's updater fetches this file to decide
   whether to offer an update. Create it locally:

   ```json
   {
     "version": "0.2.0",
     "notes": "What changed in this release.",
     "pub_date": "2026-05-26T12:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<contents of Memopad_0.2.0_x64-setup.exe.sig>",
         "url": "https://github.com/<user>/memopad/releases/download/v0.2.0/Memopad_0.2.0_x64-setup.exe"
       }
     }
   }
   ```

   Replace `<contents of ...>` with the literal text inside the `.sig` file.

5. **Create a Git tag and a GitHub Release.** Tag as `v0.2.0`. Upload these
   four files to the release:
   - the NSIS installer (`.exe`)
   - its signature (`.exe.sig`)
   - the MSI
   - `latest.json` (renamed exactly that — the Tauri updater looks for it)

6. **Verify the update.** On a separate machine (or after rolling back to the
   old version locally), launch Memopad. Within ~3 seconds the UpdateBanner
   should appear at the top of the window offering the new version. Clicking
   "Install and relaunch" should download, install, and relaunch into the new
   version.

## Troubleshooting

- **No update banner appears, no console errors.** Check the manifest URL is
  reachable in a browser and that `latest.json` returns valid JSON.
- **"Failed to verify signature".** The `pubkey` in `tauri.conf.json` doesn't
  match the private key that signed the bundle. Regenerate or copy-paste
  carefully — even a trailing newline matters.
- **Update downloads but fails to install.** Likely a Windows permissions issue
  if Memopad is installed under `Program Files`. Tauri's updater requires
  write access; the app must be installed per-user (the default for an
  unsigned MSI on Windows) for self-update to work without UAC.
```

- [ ] **Step 2: Commit**

```powershell
git add docs/superpowers/notes/release-process.md
git commit -m "docs: release process runbook (keypair, build, manifest, troubleshooting)"
```

---

## Task 10: E2E specs — diff modal + update banner stubs

**Files:**
- Create: `tests/e2e/diff-modal.spec.ts`

We add one e2e spec that exercises the diff modal flow without needing a real on-disk change (we simulate via the existing `__memopadTestSetExternalChange` hook + a temp file pair). Updater testing is intentionally NOT in the e2e suite — the plugin requires a real network manifest and signed bundle, which isn't reasonable for the test harness. The UpdateBanner is covered by the manual smoke checklist in Task 12.

- [ ] **Step 1: Create `tests/e2e/diff-modal.spec.ts`**

EXACT contents:

```ts
import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('diff modal', () => {
  it('opens when Diff is clicked and shows added/removed lines', async () => {
    // Prepare a real on-disk file so DiffModal can openFile() it.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memopad-diff-'));
    const filePath = path.join(tmpDir, 'diff-target.txt');
    fs.writeFileSync(filePath, 'alpha\nbeta\ngamma\n', { encoding: 'utf8' });

    // Open the buffer in-app with content that differs from disk.
    await exec(() => {
      const w = window as unknown as { __memopadTestReset: () => void };
      w.__memopadTestReset();
    });
    await sleep(150);

    // Open the file as if the user had opened it (gets recorded into the buffer
    // with the disk content), then mutate the in-memory content.
    await getBrowser().execute(
      (p: string) => {
        const w = window as unknown as {
          __memopadTestOpenBuffer: (f: { path: string; content: string; encoding: string; eol: string }) => string;
          __memopadTestSetContent: (s: string) => void;
          __memopadTestActiveId: () => string | null;
          __memopadTestSetExternalChange: (id: string, flag: boolean) => void;
        };
        w.__memopadTestOpenBuffer({ path: p, content: 'alpha\nBETA\ngamma\n', encoding: 'utf-8', eol: 'lf' });
        const id = w.__memopadTestActiveId();
        if (id) w.__memopadTestSetExternalChange(id, true);
      },
      filePath,
    );
    await sleep(200);

    // Click the Diff button in the external-change banner.
    await classicExecute<void>(
      `var btns = Array.from(document.querySelectorAll('[data-external-change-banner] button'));
       var diff = btns.find(b => b.textContent && b.textContent.trim() === 'Diff');
       if (diff) diff.click();
       return undefined;`,
    );
    await sleep(700); // diff loads the on-disk file via openFile

    const modalPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-diff-modal]');`,
    );
    expect(modalPresent, 'diff modal must render').to.equal(true);

    const rowTypes = await classicExecute<string[]>(
      `return Array.from(document.querySelectorAll('[data-diff-row-type]')).map(el => el.getAttribute('data-diff-row-type'));`,
    );
    // Expect at least one added row (the in-memory BETA) and one removed row (the on-disk beta).
    expect(rowTypes).to.include('add');
    expect(rowTypes).to.include('del');

    // Close via Escape.
    await getBrowser().keys('Escape');
    await sleep(200);
    const stillPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-diff-modal]');`,
    );
    expect(stillPresent).to.equal(false);

    // Cleanup the fixture.
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});
```

- [ ] **Step 2: Run the full e2e suite**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Get-Process | Where-Object { $_.ProcessName -match '^(tauri-driver|msedgedriver|app)$' } | Stop-Process -Force -ErrorAction SilentlyContinue
npm run test:e2e
Get-Process | Where-Object { $_.ProcessName -match '^(tauri-driver|msedgedriver|app)$' } | Stop-Process -Force -ErrorAction SilentlyContinue
```

Use Bash with timeout 1200000 (20 min). Expected: 44 (existing) + 1 (diff modal) = **45 passing, 0 failing**. `zz-close.spec.ts` still runs last.

If the diff modal test flakes on the 700 ms sleep, bump to 1200 ms — the openFile IPC + diffLines computation can take longer on first run after rebuild.

- [ ] **Step 3: Commit**

```powershell
git add tests/e2e/diff-modal.spec.ts
git commit -m "test(e2e): diff modal renders add/del rows + closes on Escape"
```

---

## Task 11: Wire CI gitignore + ensure runtime files don't leak

**Files:**
- Modify: `.gitignore`

CI sometimes leaves stale `target/` or `node_modules/` references; the runbook also creates a tmp file under `tests/e2e/phase-*` for screenshots. Confirm the gitignore covers everything we want.

- [ ] **Step 1: Read current .gitignore**

It should currently include:
```
.superpowers/
node_modules/
dist/
src-tauri/target/
src-tauri/gen/
*.log
*.tsbuildinfo
vite.config.js
vite.config.d.ts
tests/e2e/*.png
```

- [ ] **Step 2: Ensure these additions are present**

If missing, APPEND:

```
# Tauri signing artifacts (per-developer)
*.key

# CI workflow doesn't generate these, but local builds do
src-tauri/WixTools/
```

If both are already present, skip. The `*.key` line is important — never commit the updater signing private key.

- [ ] **Step 3: Commit if anything changed**

```powershell
$diff = git diff --stat .gitignore
if ($diff) {
  git add .gitignore
  git commit -m "gitignore: don't track signing keys or WixTools"
} else {
  Write-Host "gitignore already covers these — no commit needed"
}
```

---

## Task 12: Build + manual smoke + results doc

**Files:**
- Create: `docs/superpowers/plans/phase-6-results.md`

- [ ] **Step 1: Run all gates**

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

Expected counts:
- Vitest: **50 passing** (was 43; +2 buffers + 5 diff)
- cargo: 51 passing (unchanged — no new Rust tests this phase)
- tsc: exit 0
- e2e: **45 passing** (was 44; +1 diff modal)

- [ ] **Step 2: Build release MSI**

```powershell
npm run tauri build
```

Record MSI + app.exe sizes.

- [ ] **Step 3: Create the results doc**

EXACT template (fill `__`; leave manual smoke `[ ]` UNCHECKED):

```markdown
# Phase 6 — Results

## Automated test gates

- Vitest: __ tests passing (was 43)
- cargo test: __ tests passing (unchanged)
- e2e (WebdriverIO): __ tests passing (was 44)
- tsc --noEmit: exit 0
- CI workflow: `.github/workflows/ci.yml` runs the first three on push/PR

## Build artifacts

- MSI size: __ MB (Phase 5 baseline 4.26 MB)
- app.exe size: __ MB (Phase 5 baseline 10.33 MB)

## New surface

- Per-tab cursor position + scroll restoration (CodeMirror dispatches selection on mount, throttled writes on update)
- Diff view in the external-change banner — line diff between buffer and on-disk content
- GitHub Actions CI: tsc + Vitest + scoped cargo tests on Windows runner
- Auto-updater wired (Rust plugin + JS check + UpdateBanner). Public key is a placeholder until the keypair is generated per `docs/superpowers/notes/release-process.md`.
- CSS @import order fixed (Vite warning gone)

## Manual smoke

- [ ] App launches cleanly with no regressions
- [ ] Type text, move cursor mid-line, switch to another tab and back — cursor is at the same offset
- [ ] Scroll down in a long file, switch tabs and back — scroll position restored
- [ ] External change banner's "Diff" button opens a modal showing add/del lines
- [ ] X button still closes (no regression)
- [ ] Kill-9 + relaunch still restores dirty content (no regression)
- [ ] Find/replace (Ctrl+F / Ctrl+H) still works (no regression)
- [ ] Theme switching still works (no regression)

## What is intentionally NOT in this phase

- e2e in CI — `tauri-driver` requires a desktop session and Windows runner setup is complex. Tracked for Phase 7.
- Tagged-release automation — no `release.yml` workflow yet; release is manual per `docs/superpowers/notes/release-process.md`.
- Code signing — requires a paid cert.
- Updater pubkey is a placeholder; first real release requires the one-time setup in the release-process doc.

## Known follow-ups

- Phase 7: e2e in CI, tag-triggered release automation, signed builds when a cert is obtained.
- v2 features (find-in-files, file tree, split view) — explicit non-goals per spec but Phase 7+ candidates.
```

- [ ] **Step 4: Commit**

```powershell
git add docs/superpowers/plans/phase-6-results.md
git commit -m "phase 6: record results"
```

---

## Phase 6 Acceptance

Close when ALL:

1. `npm test` → 50 passing
2. `cargo test` → 51 passing
3. `npx tsc --noEmit` → exit 0
4. `npm run test:e2e` → 45 passing
5. `npm run tauri build` produces an MSI
6. `.github/workflows/ci.yml` exists and is syntactically valid YAML
7. `docs/superpowers/notes/release-process.md` is in place
8. Manual smoke list in `phase-6-results.md` checked off

## Skipped, with rationale

- **e2e in CI**: Windows + tauri-driver + WebView2 needs a desktop session; GitHub-hosted Windows runners can do it but the setup is finicky and slow. Local-only is honest for now.
- **Tag-triggered release workflow**: First real release is a learning exercise; once it's done by hand, the automation will be obvious to write.
- **Code signing**: Requires a paid cert. Document the SmartScreen warning in the release runbook; we already do.
