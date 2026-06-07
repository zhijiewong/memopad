# Editor Polish (Word Wrap + Indent Guides) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two global, persisted editor view preferences — word wrap and indentation guides — toggleable from the command palette (both), `Alt+Z` (wrap), and a status-bar "Wrap" segment.

**Architecture:** Two booleans in a new `useEditorPrefs` Zustand store drive conditional CodeMirror extensions (`EditorView.lineWrapping`, `indentationMarkers()`) in every `EditorPane`. The flags persist in `session.json` via the existing `persistSession`/`bootRestore` path.

**Tech Stack:** React 18 + TS, Zustand, CodeMirror 6 (`@uiw/react-codemirror`), `@replit/codemirror-indentation-markers` (new dep); Rust/serde (`session.rs`); Vitest + WebdriverIO/Mocha.

Spec: `docs/superpowers/specs/2026-06-01-editor-prefs-design.md`

---

## File Structure

- **Create** `src/stores/editorPrefs.ts` — the global prefs store (`wordWrap`, `indentGuides`).
- **Create** `src/tests/editor-prefs.test.ts` — store + session round-trip vitest.
- **Create** `tests/e2e/editor-prefs.spec.ts` — e2e.
- **Modify** `src/main.tsx` — add `__memopadTestEditorPrefs` read hook (e2e).
- **Modify** `src/components/EditorPane.tsx` — conditional extensions.
- **Modify** `src/components/StatusBar.tsx` — "Wrap" segment.
- **Modify** `src/commands/builtins.ts` — two toggle commands.
- **Modify** `src/App.tsx` — `persistSession` writes the flags; `useEditorPrefs` subscription; `Alt+Z` shortcut.
- **Modify** `src/lib/boot.ts` — restore the flags.
- **Modify** `src/lib/tauri.ts` — `SessionState` type fields.
- **Modify** `src-tauri/src/session.rs` — `word_wrap` / `indent_guides` fields + serde test.
- **Modify** `package.json` — new dependency.
- **Modify** `package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` / `CHANGELOG.md` — 0.5.0.

---

## Task 1: Editor preferences store

**Files:**
- Create: `src/stores/editorPrefs.ts`
- Create: `src/tests/editor-prefs.test.ts`
- Modify: `src/main.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/tests/editor-prefs.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorPrefs } from '../stores/editorPrefs';

describe('useEditorPrefs', () => {
  beforeEach(() => useEditorPrefs.getState().reset());

  it('defaults: wrap off, guides on', () => {
    expect(useEditorPrefs.getState().wordWrap).toBe(false);
    expect(useEditorPrefs.getState().indentGuides).toBe(true);
  });

  it('toggleWordWrap flips wordWrap', () => {
    useEditorPrefs.getState().toggleWordWrap();
    expect(useEditorPrefs.getState().wordWrap).toBe(true);
  });

  it('toggleIndentGuides flips indentGuides', () => {
    useEditorPrefs.getState().toggleIndentGuides();
    expect(useEditorPrefs.getState().indentGuides).toBe(false);
  });

  it('setters set explicit values', () => {
    useEditorPrefs.getState().setWordWrap(true);
    useEditorPrefs.getState().setIndentGuides(false);
    expect(useEditorPrefs.getState().wordWrap).toBe(true);
    expect(useEditorPrefs.getState().indentGuides).toBe(false);
  });

  it('reset returns to defaults', () => {
    useEditorPrefs.getState().setWordWrap(true);
    useEditorPrefs.getState().setIndentGuides(false);
    useEditorPrefs.getState().reset();
    expect(useEditorPrefs.getState().wordWrap).toBe(false);
    expect(useEditorPrefs.getState().indentGuides).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/tests/editor-prefs.test.ts`
Expected: FAIL — cannot resolve `../stores/editorPrefs`.

- [ ] **Step 3: Implement the store**

Create `src/stores/editorPrefs.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/tests/editor-prefs.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the e2e read hook**

In `src/main.tsx`, add the import and the window hook. Add to the imports at the top:

```ts
import { useEditorPrefs } from './stores/editorPrefs';
```

Add to the `w` type declaration object (inside the `as unknown as { ... }` block):

```ts
  __memopadTestEditorPrefs?: () => { wordWrap: boolean; indentGuides: boolean };
```

Add the assignment alongside the other `w.__memopad*` lines (before the `ReactDOM.createRoot` call):

```ts
w.__memopadTestEditorPrefs = () => ({
  wordWrap: useEditorPrefs.getState().wordWrap,
  indentGuides: useEditorPrefs.getState().indentGuides,
});
```

- [ ] **Step 6: Verify types**

Run: `npx tsc --noEmit`
Expected: clean (trust tsc, not the LSP).

- [ ] **Step 7: Commit**

```bash
git add src/stores/editorPrefs.ts src/tests/editor-prefs.test.ts src/main.tsx
git commit -m "feat(editor): global word-wrap + indent-guides prefs store"
```

---

## Task 2: Indent-markers dependency + EditorPane wiring

**Files:**
- Modify: `package.json` (dependency)
- Modify: `src/components/EditorPane.tsx`

- [ ] **Step 1: Install the dependency**

Run: `npm install @replit/codemirror-indentation-markers@^6.5.3`
Expected: adds the package to `package.json` dependencies + updates `package-lock.json`. (It is CM6-compatible. If `^6.5.3` fails to resolve, install the latest `6.x`: `npm install @replit/codemirror-indentation-markers@^6` and note the resolved version in the commit.)

- [ ] **Step 2: Wire conditional extensions into EditorPane**

In `src/components/EditorPane.tsx`:

Add imports near the other CodeMirror imports (after the `@codemirror/search` import block):

```ts
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { useEditorPrefs } from '../stores/editorPrefs';
```

Add store subscriptions next to the existing `themeMode` line (around line 69):

```ts
  const wordWrap = useEditorPrefs((s) => s.wordWrap);
  const indentGuides = useEditorPrefs((s) => s.indentGuides);
```

Change the `extensions` prop (currently lines ~249-254) to splice in the two conditional extensions:

```tsx
          extensions={[
            editorTheme,
            themeExt,
            search(),
            ...(wordWrap ? [EditorView.lineWrapping] : []),
            ...(indentGuides ? [indentationMarkers()] : []),
            ...languageForPath(buffer.path),
          ]}
```

(`EditorView` is already imported at the top of the file.)

- [ ] **Step 3: Verify types + no unit regressions**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; vitest still green (no new unit tests here — behavior is exercised by e2e in Task 8).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/components/EditorPane.tsx
git commit -m "feat(editor): apply word-wrap + indent-guide extensions from prefs"
```

---

## Task 3: Rust SessionState fields + serde back-compat

**Files:**
- Modify: `src-tauri/src/session.rs`

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/session.rs` (if no test module exists, create one at the end of the file: `#[cfg(test)] mod tests { use super::*; ... }`):

```rust
#[test]
fn session_state_defaults_editor_prefs_when_absent() {
    // Old session.json without the new fields must still deserialize.
    let json = r#"{ "tabs": [], "active_id": null }"#;
    let s: SessionState = serde_json::from_str(json).unwrap();
    assert_eq!(s.word_wrap, None);
    assert_eq!(s.indent_guides, None);
}

#[test]
fn session_state_roundtrips_editor_prefs() {
    let mut s = SessionState::default();
    s.word_wrap = Some(true);
    s.indent_guides = Some(false);
    let json = serde_json::to_string(&s).unwrap();
    let back: SessionState = serde_json::from_str(&json).unwrap();
    assert_eq!(back.word_wrap, Some(true));
    assert_eq!(back.indent_guides, Some(false));
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib session::tests::session_state_defaults_editor_prefs_when_absent`
Expected: FAIL — no field `word_wrap` on `SessionState`.

- [ ] **Step 3: Add the fields**

In `src-tauri/src/session.rs`, add to the `SessionState` struct (after `secondary_pane_state`, before the closing brace at ~line 50):

```rust
    #[serde(default)]
    pub word_wrap: Option<bool>,
    #[serde(default)]
    pub indent_guides: Option<bool>,
```

And add to the `impl Default for SessionState` body (after `secondary_pane_state: Vec::new(),`):

```rust
            word_wrap: None,
            indent_guides: None,
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib session::`
Expected: PASS (existing session tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/session.rs
git commit -m "feat(session): persist word_wrap + indent_guides (serde-default back-compat)"
```

---

## Task 4: TS persistence wiring (type + save + restore) + round-trip test

**Files:**
- Modify: `src/lib/tauri.ts`
- Modify: `src/App.tsx`
- Modify: `src/lib/boot.ts`
- Modify: `src/tests/editor-prefs.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/tests/editor-prefs.test.ts`:

```ts
import { vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { applyEditorPrefsFromSession } from '../lib/boot';

describe('editor prefs session restore', () => {
  beforeEach(() => useEditorPrefs.getState().reset());

  it('applies non-null flags from session', () => {
    applyEditorPrefsFromSession({ word_wrap: true, indent_guides: false });
    expect(useEditorPrefs.getState().wordWrap).toBe(true);
    expect(useEditorPrefs.getState().indentGuides).toBe(false);
  });

  it('leaves defaults when fields are absent/null', () => {
    applyEditorPrefsFromSession({});
    expect(useEditorPrefs.getState().wordWrap).toBe(false);
    expect(useEditorPrefs.getState().indentGuides).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/tests/editor-prefs.test.ts`
Expected: FAIL — `applyEditorPrefsFromSession` is not exported.

- [ ] **Step 3: Add the SessionState type fields**

In `src/lib/tauri.ts`, add to the `SessionState` interface (after `secondary_pane_state?: PaneCursor[];`):

```ts
  word_wrap?: boolean | null;
  indent_guides?: boolean | null;
```

- [ ] **Step 4: Add the restore helper + call it in bootRestore**

In `src/lib/boot.ts`, add the import:

```ts
import { useEditorPrefs } from '../stores/editorPrefs';
```

Add this exported helper (after the `asEol` function, before `bootRestore`):

```ts
/** Apply persisted editor prefs from a loaded session; null/absent keeps store defaults. */
export function applyEditorPrefsFromSession(
  session: { word_wrap?: boolean | null; indent_guides?: boolean | null },
): void {
  if (session.word_wrap != null) useEditorPrefs.getState().setWordWrap(session.word_wrap);
  if (session.indent_guides != null) useEditorPrefs.getState().setIndentGuides(session.indent_guides);
}
```

Call it inside `bootRestore`, right after the `useWorkspace.getState().setFolder(...)` line (~line 38):

```ts
  applyEditorPrefsFromSession(session);
```

- [ ] **Step 5: Write the flags in persistSession + subscribe**

In `src/App.tsx`, add the import (with the other store imports):

```ts
import { useEditorPrefs } from './stores/editorPrefs';
```

In `persistSession()` (the `scheduleSessionSave({ ... })` object, after `secondary_pane_state: ...`), add:

```ts
    word_wrap: useEditorPrefs.getState().wordWrap,
    indent_guides: useEditorPrefs.getState().indentGuides,
```

In the boot `useEffect` (where `stopWorkspaceWatcher` is set up, ~line 111), add a subscription so toggling prefs persists, and add its teardown:

```ts
    const stopEditorPrefsWatcher = useEditorPrefs.subscribe(() => {
      persistSession();
    });
```

And in the cleanup `return () => { ... }` block (after `stopWatcherSync();`):

```ts
      stopEditorPrefsWatcher();
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run src/tests/editor-prefs.test.ts && npx tsc --noEmit`
Expected: PASS (7 tests in the file) + tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tauri.ts src/App.tsx src/lib/boot.ts src/tests/editor-prefs.test.ts
git commit -m "feat(session): save/restore editor prefs across relaunch"
```

---

## Task 5: Command palette toggles

**Files:**
- Modify: `src/commands/builtins.ts`

- [ ] **Step 1: Implement the commands**

In `src/commands/builtins.ts`, add the import (with the other store imports near the top):

```ts
import { useEditorPrefs } from '../stores/editorPrefs';
```

Add two command registrations after the `theme.system` registration (~line 150):

```ts
  register({
    id: 'view.toggleWordWrap',
    title: 'View: Toggle Word Wrap',
    shortcut: 'Alt+Z',
    run: () => useEditorPrefs.getState().toggleWordWrap(),
  });
  register({
    id: 'view.toggleIndentGuides',
    title: 'View: Toggle Indent Guides',
    run: () => useEditorPrefs.getState().toggleIndentGuides(),
  });
```

- [ ] **Step 2: Verify types + no regressions**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; vitest green (the `commands` test counts registered commands — if it asserts an exact count, update it to include the 2 new commands).

- [ ] **Step 3: Commit**

```bash
git add src/commands/builtins.ts
git commit -m "feat(commands): Toggle Word Wrap + Toggle Indent Guides"
```

---

## Task 6: Alt+Z keyboard shortcut

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the shortcut**

In `src/App.tsx`, the keydown handler (`onKey`, ~line 171) currently starts with:

```ts
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
```

`Alt+Z` has no Ctrl/Meta, so it must be handled BEFORE the `if (!mod) return;` guard. Insert this immediately after the `const mod = ...` line and before `if (!mod) return;`:

```ts
      // Alt+Z toggles word wrap (no Ctrl/Meta — handle before the mod guard).
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        runCommand('view.toggleWordWrap');
        return;
      }
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(editor): Alt+Z toggles word wrap"
```

---

## Task 7: Status-bar "Wrap" segment

**Files:**
- Modify: `src/components/StatusBar.tsx`

- [ ] **Step 1: Implement the segment**

In `src/components/StatusBar.tsx`, add the import:

```ts
import { useEditorPrefs } from '../stores/editorPrefs';
```

Inside the `StatusBar` component, add the subscriptions (next to the existing `setActiveEncoding`/`setActiveEol` lines):

```ts
  const wordWrap = useEditorPrefs((s) => s.wordWrap);
  const toggleWordWrap = useEditorPrefs((s) => s.toggleWordWrap);
```

Add the segment button after the `eol` segment button (after its closing `</button>`, before the `{encRect && (` block):

```tsx
      <button
        type="button"
        data-status-segment="wordwrap"
        onClick={() => toggleWordWrap()}
        className={wordWrap ? 'text-neutral-100' : 'opacity-50 hover:opacity-100'}
        title="Toggle Word Wrap (Alt+Z)"
      >
        Wrap
      </button>
```

- [ ] **Step 2: Verify types + no regressions**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; vitest green.

- [ ] **Step 3: Commit**

```bash
git add src/components/StatusBar.tsx
git commit -m "feat(statusbar): clickable Wrap segment"
```

---

## Task 8: e2e — toggle word wrap + indent guides

**Files:**
- Create: `tests/e2e/editor-prefs.spec.ts`

Word wrap has a reliable DOM signal (`.cm-content` gains the `cm-lineWrapping` class). Indent guides' internal DOM is extension-specific, so the spec asserts the prefs **store** flips (via `__memopadTestEditorPrefs`) and word wrap's DOM effect; the indent-guide *rendering* is verified by the GUI smoke in Task 10.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/editor-prefs.spec.ts`:

```ts
import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('editor prefs', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadTestNewBuffer?: () => string;
        __memopadTestSetContent?: (s: string) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestNewBuffer?.();
      // A long line so wrap has a visible effect, plus indentation.
      w.__memopadTestSetContent?.('    indented line\n' + 'x'.repeat(400));
    });
    await sleep(200);
  });

  it('word wrap toggles the cm-lineWrapping class', async () => {
    const before = await classicExecute<boolean>(
      `return !!document.querySelector('.cm-content.cm-lineWrapping');`,
    );
    expect(before, 'wrap should be off by default').to.equal(false);

    await classicExecute<void>(`window.__memopadTestRunCommand('view.toggleWordWrap'); return undefined;`);
    await sleep(200);
    const after = await classicExecute<boolean>(
      `return !!document.querySelector('.cm-content.cm-lineWrapping');`,
    );
    expect(after, 'wrap should be on after toggle').to.equal(true);

    // Toggle back off.
    await classicExecute<void>(`window.__memopadTestRunCommand('view.toggleWordWrap'); return undefined;`);
    await sleep(200);
    const off = await classicExecute<boolean>(
      `return !!document.querySelector('.cm-content.cm-lineWrapping');`,
    );
    expect(off, 'wrap should be off again').to.equal(false);
  });

  it('indent guides command flips the prefs store', async () => {
    const before = await classicExecute<boolean>(`return window.__memopadTestEditorPrefs().indentGuides;`);
    expect(before, 'guides on by default').to.equal(true);

    await classicExecute<void>(`window.__memopadTestRunCommand('view.toggleIndentGuides'); return undefined;`);
    await sleep(150);
    const after = await classicExecute<boolean>(`return window.__memopadTestEditorPrefs().indentGuides;`);
    expect(after, 'guides off after toggle').to.equal(false);
  });
});
```

- [ ] **Step 2: Note on running**

Per project norm, run the whole suite at the end (Task 10), not per-spec mid-plan. To run just this spec after a release build exists:
`npx mocha --grep "editor prefs"`
Expected: 2 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/editor-prefs.spec.ts
git commit -m "test(e2e): word-wrap DOM effect + indent-guide toggle"
```

---

## Task 9: Version bump + CHANGELOG (0.5.0)

**Files:**
- Modify: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump versions to 0.5.0**

- `package.json`: `"version": "0.4.0"` → `"0.5.0"`.
- `src-tauri/Cargo.toml`: the `[package]` `version = "0.4.0"` → `"0.5.0"`.
- `src-tauri/tauri.conf.json`: `"version": "0.4.0"` → `"0.5.0"`.

- [ ] **Step 2: Sync Cargo.lock**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
(Refreshes the `app` package entry in `Cargo.lock` to 0.5.0. A trailing signing-key error after artifacts are produced is benign.)

- [ ] **Step 3: Add CHANGELOG entry**

In `CHANGELOG.md`, under `## [Unreleased]`, add:

```markdown
## [0.5.0] — 2026-06-01

Editor view polish: soft word wrap and indentation guides, both global and
remembered across relaunch.

### Added

- **Word wrap** — soft-wrap long lines to the viewport. Toggle via `Alt+Z`, the
  command palette ("View: Toggle Word Wrap"), or the **Wrap** status-bar segment.
  Off by default.
- **Indent guides** — faint vertical lines at each indentation level. Toggle via the
  command palette ("View: Toggle Indent Guides"). On by default.
- Both preferences are global (apply to all panes) and persist in `session.json`.

### Known limitations

- Windows only
- Unsigned MSI — SmartScreen warning on first install
- No per-file or per-language wrap/guide overrides
- Split view is two panes max, horizontal only
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + all green.

- [ ] **Step 5: Commit**

```bash
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "chore: bump to 0.5.0 + changelog for editor prefs"
```

---

## Task 10: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: all green (incl. new `session::` tests).

- [ ] **Step 2: TS typecheck + unit tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + all green.

- [ ] **Step 3: Release build + full e2e**

Run (Bash tool):
```bash
rm -f src-tauri/target/release/app.exe
npm run tauri build || echo "unsigned build exit tolerated"
test -f src-tauri/target/release/app.exe
npx mocha
```
Expected: full suite green, including the 2 new `editor prefs` tests.

- [ ] **Step 4: Manual GUI smoke (verify indent guides render)**

Per the GUI-verification practice: drive the real WebView via the e2e harness + `saveScreenshot`, then `Read` the PNG. Open a buffer with indented content; screenshot with indent guides **on** (default) — expect faint vertical guide lines; run "Toggle Indent Guides" + screenshot — expect them gone. Then toggle word wrap and confirm a long line wraps. (Throwaway smoke spec; delete it + the PNGs after viewing.)

- [ ] **Step 5: Final commit (only if smoke fixups were needed)** — otherwise nothing to commit.

---

## Self-Review notes

- **Spec coverage:** store (T1), conditional extensions incl. new dep (T2), Rust persistence (T3), TS save/restore + subscription (T4), command palette both (T5), Alt+Z (T6), status-bar Wrap segment (T7), e2e (T8), version+changelog (T9), GUI smoke for guide rendering (T10). All spec sections map to tasks.
- **Type consistency:** `useEditorPrefs` with `wordWrap`/`indentGuides`/`toggleWordWrap`/`toggleIndentGuides`/`setWordWrap`/`setIndentGuides`/`reset`; command ids `view.toggleWordWrap`/`view.toggleIndentGuides`; `applyEditorPrefsFromSession`; SessionState `word_wrap`/`indent_guides` (snake) ↔ store camel. Used identically across tasks.
- **Gotchas captured:** Alt+Z must precede the `if (!mod) return` guard (T6); `commands` vitest may assert an exact count to update (T5); indent-guide DOM is extension-specific so e2e asserts the store flag + word-wrap DOM, with rendering verified by GUI smoke (T8/T10).
```
