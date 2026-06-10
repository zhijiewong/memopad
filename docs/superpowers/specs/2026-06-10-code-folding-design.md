# Code Folding — Design

**Date:** 2026-06-10
**Status:** Approved
**Scope:** CM6-native code folding behind a persisted editor pref. Frontend + one
trivial Rust serde field (mirrors how the minimap pref shipped).

## Motivation

Folding is the last universal editor staple Memopad lacks. CodeMirror 6 ships the
whole mechanism (`foldGutter`, `foldKeymap`, `foldAll`/`unfoldAll`,
syntax-tree-driven fold ranges), and the project already has an exact precedent for
"toggleable, session-persisted editor pref" in word-wrap / indent-guides / minimap.
This slice flips folding on behind that pattern.

## Goals

1. **Fold gutter** with clickable arrows on foldable blocks; folded regions collapse
   to a "…" placeholder.
2. **Keyboard**: Ctrl+Shift+[ / Ctrl+Shift+] fold/unfold the current block;
   Ctrl+Alt+[ / Ctrl+Alt+] fold/unfold all (CM's stock `foldKeymap`, verified
   conflict-free with app bindings).
3. **Pref**: `codeFolding` in `useEditorPrefs`, default **on**, persisted app-globally
   in session like the other three prefs; palette "View: Toggle Code Folding". Off ⇒
   no gutter, no fold keys.
4. **Palette**: "View: Fold All" / "View: Unfold All".

## Non-goals (YAGNI)

- Persisting fold state across restart (folds are ephemeral; possible follow-up).
- Indentation-based fold fallback for legacy stream-mode languages (YAML, TOML, Go,
  Ruby, shell…) — they show no fold arrows. The ~12 first-class languages (JS/TS,
  JSON, Markdown, Rust, Python, HTML, CSS, XML, SQL, C/C++, Java, PHP) cover the
  real use.
- Per-block fold/unfold palette entries, fold-by-level commands, status-bar changes.

## Verified facts (this repo)

- `@uiw/react-codemirror`'s `basicSetup` object accepts `foldGutter` and
  `foldKeymap` booleans; EditorPane currently sets `foldGutter: false` and omits
  `foldKeymap`.
- `@codemirror/language` exports `foldAll`, `unfoldAll`, `foldedRanges`,
  `foldState`; `foldKeymap` binds `Ctrl-Shift-[`/`]` (fold/unfold block) and
  `Ctrl-Alt-[`/`]` (fold/unfold all). None collide with App.tsx or `Prec.high`
  editor bindings.
- Editor prefs flow: `useEditorPrefs` (zustand) → `SessionState`
  (`word_wrap`/`indent_guides`/`minimap`, all `#[serde(default)]`) →
  `applyEditorPrefsFromSession` in `boot.ts` / `persistApp` in App.tsx.

## Design

### `src/stores/editorPrefs.ts`
Add `codeFolding: boolean` (default `true`) + `toggleCodeFolding()` + include in
`reset()` and the `applyFromSession` path, mirroring `minimap` exactly.

### `src/components/EditorPane.tsx`
- In `basicSetup`: set `foldGutter: prefs.codeFolding` and
  `foldKeymap: prefs.codeFolding` (subscribe to the pref like `wordWrap`).
- Focused-pane window global `__memopadFoldCommand('foldAll' | 'unfoldAll')`
  dispatching `foldAll`/`unfoldAll` from `@codemirror/language` on the focused view,
  registered/cleaned up alongside `__memopadLineCommand` etc.

### `src/commands/builtins.ts`
- `view.toggleCodeFolding` — "View: Toggle Code Folding" → `toggleCodeFolding()`.
- `view.foldAll` — "View: Fold All", shortcut label `Ctrl+Alt+[` →
  `__memopadFoldCommand('foldAll')`.
- `view.unfoldAll` — "View: Unfold All", shortcut label `Ctrl+Alt+]` →
  `__memopadFoldCommand('unfoldAll')`.

### Session persistence (mirrors minimap commit-for-commit)
- Rust `session.rs`: `code_folding: bool` on the app-global prefs struct with a
  `#[serde(default = "default_true")]` (add the tiny default fn if absent; the
  existing fields show the pattern). Old session.json files without the field load
  as `true`.
- `src/lib/tauri.ts` session types + `src/lib/boot.ts`
  `applyEditorPrefsFromSession` + App.tsx `persistApp` each gain the field.

### Test hook
- EditorPane (which owns the view ref) registers a focused-pane global
  `__memopadFoldedCount(): number` next to `__memopadFoldCommand`, computed by
  iterating `foldedRanges(view.state)` (a `RangeSet` — count via `.between()` or a
  cursor). `src/main.tsx` declares and forwards it as
  `__memopadTestFoldedCount(): number` (returns 0 when no view), keeping the
  test-hook surface in main.tsx like the other `__memopadTest*` hooks.

## Testing

- **Unit (vitest):** `editorPrefs` flag — default true, toggle, reset, and the
  session-apply path (extend `editor-prefs.test.ts` and `boot.test.ts` per the
  minimap precedent). Rust: extend the session round-trip test with `code_folding`
  + missing-field default.
- **e2e (`tests/e2e/folding.spec.ts`):** open a buffer with foldable JS content
  (function block) and the language set via `__memopadTestSetLanguage('javascript')`;
  `__memopadFoldCommand('foldAll')` → `__memopadTestFoldedCount() > 0`;
  `unfoldAll` → `0`; `.cm-foldGutter` present; run `view.toggleCodeFolding` via
  `__memopadTestRunCommand` → `.cm-foldGutter` absent (toggle back + reset pref in
  cleanup so the pref doesn't leak into later specs — see the persisted-state
  gotcha in known-e2e-failures); `view.foldAll`/`view.unfoldAll`/
  `view.toggleCodeFolding` registered in `__memopadTestCommandIds()`.
- **Manual smoke:** arrows in gutter, click folds a block to "…", click placeholder
  unfolds, Ctrl+Alt+[ folds all, pref toggle hides the gutter.

## Gates / Definition of done

`npx tsc --noEmit` clean · `npm test` (extends prefs/boot tests) · `cargo test`
(extends session test) · full local e2e green (local e2e works again as of
2026-06-10; confirm `app.exe` mtime > edits before trusting) · merge `--no-ff`,
tag `v1.4.0` (minor), signed GitHub release.
