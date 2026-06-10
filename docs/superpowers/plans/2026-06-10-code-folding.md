# Code Folding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable CM6 code folding (gutter arrows + fold keymap + Fold/Unfold All palette commands) behind a persisted `codeFolding` editor pref, mirroring the minimap pref end-to-end.

**Architecture:** Frontend flips `foldGutter`/`foldKeymap` in EditorPane's `basicSetup` from a new `useEditorPrefs.codeFolding` flag (default on). The pref persists through the existing app-global session path (`EditorPrefs` wire → Rust `session.rs` `Option<bool>` field → `applyAppGlobal` on boot). Fold/Unfold All run via a focused-pane `__memopadFoldCommand` global like `__memopadLineCommand`. Folds themselves are ephemeral.

**Tech Stack:** React + TS + Zustand + CodeMirror 6 (`@codemirror/language` `foldAll`/`unfoldAll`/`foldedRanges`); Rust serde for the session field; vitest + cargo test + WebdriverIO/Mocha e2e (local e2e works — confirm `app.exe` mtime is newer than your edits).

**Spec:** `docs/superpowers/specs/2026-06-10-code-folding-design.md`

**Gates per task:** `npx tsc --noEmit` clean; `npm test` green; `cargo test` (in `src-tauri`) for the Rust task. Stage explicit paths only. Trust `npx tsc --noEmit` over LSP diagnostics.

---

## Task 1: `codeFolding` flag in the editor-prefs store

**Files:**
- Modify: `src/stores/editorPrefs.ts`
- Test: `src/tests/editor-prefs.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/tests/editor-prefs.test.ts`, after the `describe('useEditorPrefs minimap', ...)` block (ends line 70), add:

```ts
describe('useEditorPrefs codeFolding', () => {
  beforeEach(() => useEditorPrefs.getState().reset());

  it('defaults codeFolding on', () => {
    expect(useEditorPrefs.getState().codeFolding).toBe(true);
  });
  it('toggleCodeFolding flips it', () => {
    useEditorPrefs.getState().toggleCodeFolding();
    expect(useEditorPrefs.getState().codeFolding).toBe(false);
  });
  it('setCodeFolding sets it; reset restores default', () => {
    useEditorPrefs.getState().setCodeFolding(false);
    expect(useEditorPrefs.getState().codeFolding).toBe(false);
    useEditorPrefs.getState().reset();
    expect(useEditorPrefs.getState().codeFolding).toBe(true);
  });
});
```

And in the `describe('editor prefs session restore', ...)` block, add:

```ts
  it('applies code_folding from session', () => {
    applyEditorPrefsFromSession({ code_folding: false });
    expect(useEditorPrefs.getState().codeFolding).toBe(false);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- editor-prefs`
Expected: FAIL — `codeFolding`/`toggleCodeFolding` do not exist (type + runtime errors). (The `code_folding` wire-field test also fails to typecheck until Task 3 — that's fine; vitest reports per-file compile errors. If the file-level compile error masks the first three tests, proceed: Step 4 re-runs after implementation, and the session-restore test goes green in Task 3.)

- [ ] **Step 3: Implement the store flag**

Replace the contents of `src/stores/editorPrefs.ts` with:

```ts
import { create } from 'zustand';

interface EditorPrefsState {
  /** Soft-wrap long lines to the viewport. Default off. */
  wordWrap: boolean;
  /** Show vertical indentation guides. Default on. */
  indentGuides: boolean;
  /** Show the code-overview minimap. Default off. */
  minimap: boolean;
  /** Show the fold gutter + enable fold keybindings. Default on. */
  codeFolding: boolean;
  toggleMinimap: () => void;
  setMinimap: (v: boolean) => void;
  toggleWordWrap: () => void;
  toggleIndentGuides: () => void;
  setWordWrap: (v: boolean) => void;
  setIndentGuides: (v: boolean) => void;
  toggleCodeFolding: () => void;
  setCodeFolding: (v: boolean) => void;
  reset: () => void;
}

const DEFAULTS = { wordWrap: false, indentGuides: true, minimap: false, codeFolding: true };

export const useEditorPrefs = create<EditorPrefsState>((set) => ({
  ...DEFAULTS,
  toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
  toggleIndentGuides: () => set((s) => ({ indentGuides: !s.indentGuides })),
  toggleMinimap: () => set((s) => ({ minimap: !s.minimap })),
  setMinimap: (v) => set({ minimap: v }),
  setWordWrap: (v) => set({ wordWrap: v }),
  setIndentGuides: (v) => set({ indentGuides: v }),
  toggleCodeFolding: () => set((s) => ({ codeFolding: !s.codeFolding })),
  setCodeFolding: (v) => set({ codeFolding: v }),
  reset: () => set({ ...DEFAULTS }),
}));
```

- [ ] **Step 4: Run to verify the store tests pass**

Run: `npm test -- editor-prefs`
Expected: the three `codeFolding` store tests PASS. The `code_folding` session-restore test still fails (wire type/apply land in Task 3) — acceptable interim state, but `npx tsc --noEmit` will flag the unknown wire field; to keep the tree green per-commit, comment NOTHING out — instead move that one session-restore test into Task 3's step. **Concretely: only add the `describe('useEditorPrefs codeFolding')` block in this task; add the session-restore test in Task 3 Step 1.**

- [ ] **Step 5: Verify tsc + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/stores/editorPrefs.ts src/tests/editor-prefs.test.ts
git commit -m "feat: codeFolding editor pref (store)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Rust session field `code_folding`

**Files:**
- Modify: `src-tauri/src/session.rs` (struct ~line 81; literal ~line 142; tests ~lines 419–473)

- [ ] **Step 1: Write the failing tests**

In the `#[cfg(test)]` module of `src-tauri/src/session.rs`, next to `session_state_defaults_minimap_when_absent` (~line 419), add:

```rust
    #[test]
    fn editor_prefs_default_code_folding_when_absent() {
        let p: EditorPrefs = serde_json::from_str("{}").unwrap();
        assert_eq!(p.code_folding, None);
    }

    #[test]
    fn editor_prefs_roundtrips_code_folding() {
        let p = EditorPrefs { code_folding: Some(false), ..Default::default() };
        let json = serde_json::to_string(&p).unwrap();
        let back: EditorPrefs = serde_json::from_str(&json).unwrap();
        assert_eq!(back.code_folding, Some(false));
    }
```

- [ ] **Step 2: Run to verify compile failure**

Run: `cd src-tauri && cargo test code_folding`
Expected: FAIL — no field `code_folding` on `EditorPrefs`.

- [ ] **Step 3: Add the field**

In `pub struct EditorPrefs` (~line 81), after the `minimap` field add:

```rust
    #[serde(default)]
    pub code_folding: Option<bool>,
```

In `to_app_session`'s `editor_prefs: EditorPrefs { ... }` literal (~line 142), after `minimap: l.minimap,` add:

```rust
                code_folding: None,
```

(Legacy sessions predate folding; `None` lets the frontend default apply. `LegacySession` itself is NOT modified.)

- [ ] **Step 4: Run to verify pass**

Run: `cd src-tauri && cargo test`
Expected: all tests pass, including the two new ones; no other literals break (`EditorPrefs` derives `Default`, and the only struct literal is the one patched above — the `minimap: None` literals elsewhere in tests are `LegacySession`, untouched).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/session.rs
git commit -m "feat: code_folding session pref field (Rust)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire type + boot apply + persist

**Files:**
- Modify: `src/lib/tauri.ts` (~line 63), `src/lib/window-session.ts` (~line 34), `src/App.tsx` (~line 44)
- Test: `src/tests/editor-prefs.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/tests/editor-prefs.test.ts`, in `describe('editor prefs session restore', ...)`, add:

```ts
  it('applies code_folding from session', () => {
    applyEditorPrefsFromSession({ code_folding: false });
    expect(useEditorPrefs.getState().codeFolding).toBe(false);
  });
```

Run: `npm test -- editor-prefs` → FAIL (unknown field `code_folding` on `EditorPrefsWire`, and apply does nothing).

- [ ] **Step 2: Extend the wire type**

In `src/lib/tauri.ts`, `EditorPrefsWire` (~line 63), add:

```ts
  code_folding?: boolean | null;
```

- [ ] **Step 3: Apply on boot**

In `src/lib/window-session.ts` `applyAppGlobal` (~line 34), after the `minimap` line add:

```ts
  if (prefs.code_folding != null) useEditorPrefs.getState().setCodeFolding(prefs.code_folding);
```

- [ ] **Step 4: Persist**

In `src/App.tsx` `persistApp` (~line 44), after `minimap: ...,` add:

```ts
      code_folding: useEditorPrefs.getState().codeFolding,
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm test -- editor-prefs`
Expected: tsc clean; all editor-prefs tests pass including the new restore test.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tauri.ts src/lib/window-session.ts src/App.tsx src/tests/editor-prefs.test.ts
git commit -m "feat: persist/restore code_folding pref

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: EditorPane — fold gutter/keymap from pref + fold globals

**Files:**
- Modify: `src/components/EditorPane.tsx`

- [ ] **Step 1: Imports**

Add to the existing imports:

```ts
import { foldAll, unfoldAll, foldedRanges } from '@codemirror/language';
```

- [ ] **Step 2: Subscribe to the pref**

Next to `const minimap = useEditorPrefs((s) => s.minimap);` (~line 108) add:

```ts
  const codeFolding = useEditorPrefs((s) => s.codeFolding);
```

- [ ] **Step 3: Drive basicSetup from it**

In the `basicSetup={{ ... }}` object (~line 375), change `foldGutter: false,` to:

```ts
            foldGutter: codeFolding,
            foldKeymap: codeFolding,
```

(Explicit `foldKeymap` matters: basicSetup includes the fold keys by default, so pref-off must disable both gutter AND keys.)

- [ ] **Step 4: Declare the new globals**

In the `declare global` block, after `__memopadMultiCursorCommand` add:

```ts
  // eslint-disable-next-line no-var
  var __memopadFoldCommand: ((cmd: 'foldAll' | 'unfoldAll') => void) | undefined;
  // eslint-disable-next-line no-var
  var __memopadFoldedCount: (() => number) | undefined;
```

- [ ] **Step 5: Register + clean up the globals**

In the focused-pane dispatcher effect, after the `__memopadMultiCursorCommand` assignment add:

```ts
    globalThis.__memopadFoldCommand = (cmd) => {
      const v = viewRef.current;
      if (!v) return;
      (cmd === 'foldAll' ? foldAll : unfoldAll)(v);
      v.focus();
    };
    globalThis.__memopadFoldedCount = () => {
      const v = viewRef.current;
      if (!v) return 0;
      let n = 0;
      foldedRanges(v.state).between(0, v.state.doc.length, () => { n += 1; });
      return n;
    };
```

And in that effect's cleanup, add:

```ts
      globalThis.__memopadFoldCommand = undefined;
      globalThis.__memopadFoldedCount = undefined;
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/EditorPane.tsx
git commit -m "feat: fold gutter/keymap behind codeFolding pref + fold globals

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Palette commands

**Files:**
- Modify: `src/commands/builtins.ts` (after `view.toggleMinimap`, ~line 194)

- [ ] **Step 1: Register**

After the `view.toggleMinimap` registration add:

```ts
  register({
    id: 'view.toggleCodeFolding',
    title: 'View: Toggle Code Folding',
    run: () => useEditorPrefs.getState().toggleCodeFolding(),
  });
  register({
    id: 'view.foldAll',
    title: 'View: Fold All',
    shortcut: 'Ctrl+Alt+[',
    run: () => globalThis.__memopadFoldCommand?.('foldAll'),
  });
  register({
    id: 'view.unfoldAll',
    title: 'View: Unfold All',
    shortcut: 'Ctrl+Alt+]',
    run: () => globalThis.__memopadFoldCommand?.('unfoldAll'),
  });
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npm test -- commands`
Expected: clean / pass.

```bash
git add src/commands/builtins.ts
git commit -m "feat: Fold All / Unfold All / Toggle Code Folding palette commands

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Test hook in main.tsx

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: Declare + assign**

In the `const w = window as unknown as { ... }` type block, after `__memopadTestSelectionCount` add:

```ts
  __memopadTestFoldedCount?: () => number;
```

After the `w.__memopadTestSelectionCount = ...` assignment add:

```ts
w.__memopadTestFoldedCount = () => globalThis.__memopadFoldedCount?.() ?? 0;
```

(`__memopadFoldedCount` is declared `declare global` in EditorPane.tsx — Task 4 — so this typechecks.)

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/main.tsx
git commit -m "test: __memopadTestFoldedCount hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: e2e spec

**Files:**
- Create: `tests/e2e/folding.spec.ts`

- [ ] **Step 1: Write the spec**

First open `tests/e2e/editor-prefs.spec.ts` AND `tests/e2e/bracket-nav.spec.ts` and copy their real import/helper/`beforeEach` structure (the code below is illustrative — match the actual `classicExecute`/`setEditorContent`/`getBrowser` signatures). Critical hygiene (per known-e2e-failures): `__memopadTestResetEditorPrefs` in `beforeEach` (the pref persists in session.json across runs!), and end the spec with folding pref ON + all unfolded so nothing leaks into later alphabetical specs.

```ts
describe('code folding', () => {
  beforeEach(/* reset buffers + __memopadTestResetEditorPrefs, per editor-prefs.spec.ts */);

  it('foldAll folds a JS function body; unfoldAll restores it', async () => {
    await setEditorContent('function f() {\n  one();\n  two();\n}\n');
    await classicExecute(`window.__memopadTestSetLanguage('javascript');`);
    await classicExecute(`window.__memopadFoldCommand('foldAll');`);
    const folded = await classicExecute<number>(`return window.__memopadTestFoldedCount();`);
    expect(folded).to.be.greaterThan(0);
    await classicExecute(`window.__memopadFoldCommand('unfoldAll');`);
    const after = await classicExecute<number>(`return window.__memopadTestFoldedCount();`);
    expect(after).to.equal(0);
  });

  it('toggleCodeFolding hides and restores the fold gutter', async () => {
    await setEditorContent('function f() {\n  one();\n}\n');
    await classicExecute(`window.__memopadTestSetLanguage('javascript');`);
    const gutterOn = await classicExecute<boolean>(
      `return !!document.querySelector('.cm-foldGutter');`);
    expect(gutterOn).to.equal(true);
    await classicExecute(`window.__memopadTestRunCommand('view.toggleCodeFolding');`);
    const gutterOff = await classicExecute<boolean>(
      `return !!document.querySelector('.cm-foldGutter');`);
    expect(gutterOff).to.equal(false);
    // restore for later specs
    await classicExecute(`window.__memopadTestRunCommand('view.toggleCodeFolding');`);
  });

  it('registers the folding palette commands', async () => {
    const ids = await classicExecute<string[]>(`return window.__memopadTestCommandIds();`);
    expect(ids).to.include('view.foldAll');
    expect(ids).to.include('view.unfoldAll');
    expect(ids).to.include('view.toggleCodeFolding');
  });
});
```

Note: if the fold-gutter DOM check proves timing-sensitive after the toggle (React re-render + CM reconfigure), poll briefly for the condition (see `pollFor` usage in `file-tree-crud.spec.ts`) rather than sleeping.

- [ ] **Step 2: Typecheck (do NOT run mocha yet)**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/folding.spec.ts
git commit -m "test: e2e for code folding

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Verify, review, ship

- [ ] **Step 1: Full gates + local e2e**

Run: `npx tsc --noEmit && npm test`; `cd src-tauri && cargo test`; then rebuild + full e2e:
`npm run tauri -- build --no-bundle` (confirm `src-tauri/target/release/app.exe` mtime is NOW) then `npx mocha`.
Expected: tsc clean · vitest ≥199 · cargo ≥127 · e2e 93/93 (90 + 3 new). If a single
unrelated spec flakes, rerun once (documented flake); a deterministic folding-spec failure is real — debug it.

- [ ] **Step 2: Code review**

Invoke `superpowers:requesting-code-review` on `main..HEAD`; address high-confidence findings.

- [ ] **Step 3: Release (confirm with user first)**

Bump to **1.4.0** in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (`app` entry); CHANGELOG `## [1.4.0]` (code folding). Commit `chore: 1.4.0 — code folding`. Merge `--no-ff`, push, tag `v1.4.0` → signed release. **Ask the user before pushing/releasing.**

- [ ] **Step 4: Manual smoke**

Arrows in gutter for a JS file; click folds to "…"; click placeholder unfolds; Ctrl+Alt+[ folds all; "View: Toggle Code Folding" hides the gutter; plain-text buffer shows no arrows.

---

## Self-review notes

- **Spec coverage:** gutter+keymap ✓(T4 S3) · pref store ✓(T1) · session persist Rust ✓(T2) wire/apply/persist ✓(T3) · palette ✓(T5) · fold globals ✓(T4 S4-5) · test hook ✓(T6) · e2e ✓(T7) · gates/ship ✓(T8).
- **Type consistency:** `codeFolding`/`toggleCodeFolding`/`setCodeFolding` (T1) used in T3/T4/T5; wire field `code_folding` (T3) matches Rust serde name (T2); `__memopadFoldCommand('foldAll'|'unfoldAll')` declared T4, used T5/T7; `__memopadFoldedCount` T4 → forwarded T6 → asserted T7.
- **Sequencing fix applied:** the `code_folding` wire test originally placed in Task 1 would break tsc before Task 3 — moved to Task 3 Step 1 so every commit is green.
