# Editor Minimap — Design

**Date:** 2026-06-02
**Status:** Approved (brainstorming) — awaiting implementation plan
**Target version:** 0.9.0

## Problem

The editor has no code-overview minimap. It's a common editor affordance for navigating
long files. This adds a toggleable, persisted minimap — structurally a third editor
preference alongside word wrap and indent guides (0.5.0).

## Decisions (locked during brainstorming)

- **Default off** — minimaps are opinionated and add visual weight; the "quiet editor"
  default is off, user opts in.
- **Palette-only** toggle ("View: Toggle Minimap") — no keyboard shortcut, no status-bar
  segment (same treatment as indent guides).
- **Fixed rendering config:** `displayText: 'blocks'`, `showOverlay: 'always'` — not
  user-configurable (no width/position/character-mode options).
- **Global** (applies to all panes), **persisted** in `session.json`.

## Architecture

A `minimap` boolean joins the existing `useEditorPrefs` store. `EditorPane` conditionally
adds the `@replit/codemirror-minimap` extension based on the flag. The flag toggles via a
command-palette entry and persists through the same `persistSession` / `applyEditorPrefsFromSession`
path that already handles `word_wrap` / `indent_guides`. This mirrors the 0.5.0 editor-prefs
feature exactly.

### 1. Dependency

Add `@replit/codemirror-minimap@^0.5.2`. Its peer deps (`@codemirror/view`/`state`/`language`/`lint`,
`@lezer/common`/`highlight`) are already satisfied transitively by the CodeMirror stack.

### 2. Prefs store — `src/stores/editorPrefs.ts`

Add to `EditorPrefsState`: `minimap: boolean`, `toggleMinimap: () => void`, `setMinimap: (v: boolean) => void`.
Add `minimap: false` to `DEFAULTS` (so `reset` covers it). Implementations mirror
`toggleWordWrap`/`setWordWrap`.

### 3. Editor — `src/components/EditorPane.tsx`

Import `showMinimap` from `@replit/codemirror-minimap`, subscribe to `minimap` from the store,
and splice the extension conditionally into the `extensions` array (next to the wrap/indent splices):

```ts
const minimap = useEditorPrefs((s) => s.minimap);
// ...
...(minimap ? [showMinimap.compute([], () => ({
  create: () => ({ dom: document.createElement('div') }),
  displayText: 'blocks',
  showOverlay: 'always',
}))] : []),
```

Both split panes read the same global flag, so they show/hide the minimap in lockstep.
`@uiw/react-codemirror` reconfigures on the `extensions` change (no remount).

### 4. Persistence — `src-tauri/src/session.rs` + `src/lib/tauri.ts` + `src/lib/boot.ts` + `src/App.tsx`

- **Rust `SessionState`:** add `minimap: Option<bool>` with `#[serde(default)]` (back-compat:
  absent → `None`); extend the `Default` impl with `minimap: None`.
- **TS `SessionState`:** add `minimap?: boolean | null;`.
- **`applyEditorPrefsFromSession`:** extend the param type with `minimap?: boolean | null` and add
  `if (session.minimap != null) useEditorPrefs.getState().setMinimap(session.minimap);`.
- **`persistSession`:** add `minimap: useEditorPrefs.getState().minimap` to the `scheduleSessionSave`
  object. (The existing `useEditorPrefs.subscribe` already triggers `persistSession` on toggle.)

### 5. Trigger — `src/commands/builtins.ts`

```ts
register({
  id: 'view.toggleMinimap',
  title: 'View: Toggle Minimap',
  run: () => useEditorPrefs.getState().toggleMinimap(),
});
```

### 6. Test hooks — `src/main.tsx`

Extend `__memopadTestEditorPrefs()` to include `minimap`, and `__memopadTestResetEditorPrefs`
already calls `reset()` (covers minimap via `DEFAULTS`).

## Error handling / edge cases

| Case | Handling |
|------|----------|
| Old `session.json` without `minimap` | `#[serde(default)]` → `None` → store default (off) |
| Split view | Both panes read the global flag → toggle together |
| `@replit/codemirror-minimap` vs CM6 | Pinned `^0.5.2`; peer deps satisfied; verify `tsc` + e2e |
| Reconfigure preserving cursor | Same in-place reconfigure as wrap/indent; cursor/scroll persistence already handled |

## Testing strategy

- **vitest** (extend `src/tests/editor-prefs.test.ts` or a new `minimap.test.ts`): `minimap`
  default off; `toggleMinimap`/`setMinimap`; `reset` clears it; session round-trip
  (`applyEditorPrefsFromSession` applies `minimap`, absent → default).
- **Rust** (`session.rs`): deserializing a blob without `minimap` yields `None`; round-trips when set.
- **e2e** (`tests/e2e/minimap.spec.ts`, release build): open a buffer; run
  `__memopadTestRunCommand('view.toggleMinimap')` → assert a `.cm-minimap` element appears in the
  editor DOM; toggle again → it's gone. Reset prefs in `beforeEach` via `__memopadTestResetEditorPrefs`
  (prefs persist across runs — the 0.5.0 gotcha).
- **GUI smoke:** screenshot the editor with the minimap on (overview strip on the right) vs off.

## Scope boundaries (YAGNI — non-goals)

- No configurable width / side / character-vs-block mode / overlay-on-hover.
- No per-buffer or per-language minimap setting.
- No keyboard shortcut or status-bar segment.

## Release

Ships as **0.9.0**. CHANGELOG: Added — toggleable code minimap (command palette "View: Toggle
Minimap"), global and persisted, off by default. Version bump in `package.json`,
`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
