# Editor Polish: Word Wrap + Indent Guides — Design

**Date:** 2026-06-01
**Status:** Approved (brainstorming) — awaiting implementation plan
**Target version:** 0.5.0

## Problem

The CodeMirror editor scrolls long lines horizontally with no option to wrap, and
renders no indentation guides. Both are baseline "quiet editor" affordances a
Notepad++-class tool is expected to offer. This adds two global, persisted editor
view preferences:

- **Word wrap** — soft-wrap long lines to the viewport width.
- **Indent guides** — faint vertical lines at each indentation level.

## Decisions (locked during brainstorming)

- **Both global** — one setting each, applied to all open files and both split panes
  (not per-buffer).
- **Persisted** across relaunch in `session.json`.
- **Defaults:** word wrap **off** (Notepad++ convention); indent guides **on**
  (matches VS Code; visible polish out of the box).
- **Triggers:** command palette for both; `Alt+Z` keyboard shortcut for word wrap;
  a clickable **"Wrap"** status-bar segment. Indent guides is palette-only (no
  status-bar segment, no keyboard shortcut).
- **Indent guides** use the `@replit/codemirror-indentation-markers` extension
  (CM6 has no built-in); pinned to a `@codemirror/view` 6-compatible version.

## Architecture

Two booleans in a new `useEditorPrefs` Zustand store drive conditional CodeMirror
extensions in every `EditorPane`. The store is persisted via the existing
session-save/boot-restore path that already handles `workspace_folder` / `split_active`.

```
useEditorPrefs (wordWrap, indentGuides)
   │  subscribed by
   ├─ EditorPane (both panes)  → conditional extensions: EditorView.lineWrapping, indentationMarkers()
   ├─ StatusBar                → "Wrap" segment (toggle)
   ├─ builtins (command palette) → "Toggle Word Wrap", "Toggle Indent Guides"
   └─ App keydown               → Alt+Z → toggleWordWrap
   │  persisted by
   └─ session save/restore      → SessionState.word_wrap / .indent_guides
```

### 1. Preferences store — `src/stores/editorPrefs.ts` (new)

Zustand store modeled on `src/stores/theme.ts`:

```ts
interface EditorPrefsState {
  wordWrap: boolean;        // default false
  indentGuides: boolean;    // default true
  toggleWordWrap: () => void;
  toggleIndentGuides: () => void;
  setWordWrap: (v: boolean) => void;
  setIndentGuides: (v: boolean) => void;
  reset: () => void;        // back to defaults
}
```

### 2. Editor wiring — `src/components/EditorPane.tsx`

Subscribe to the store and splice the extensions conditionally into the existing
`extensions` array:

```ts
const wordWrap = useEditorPrefs((s) => s.wordWrap);
const indentGuides = useEditorPrefs((s) => s.indentGuides);
// ...
extensions={[
  editorTheme,
  themeExt,
  search(),
  ...(wordWrap ? [EditorView.lineWrapping] : []),
  ...(indentGuides ? [indentationMarkers()] : []),
  ...languageForPath(buffer.path),
]}
```

`@uiw/react-codemirror` reconfigures the view when `extensions` changes (no remount,
cursor/scroll preserved). Both panes subscribe to the same global store, so split
view updates in lockstep.

### 3. Persistence — `src-tauri/src/session.rs` + `src/lib/tauri.ts`

Add to `SessionState`:
- Rust: `word_wrap: Option<bool>` and `indent_guides: Option<bool>`, each
  `#[serde(default)]` so existing `session.json` files (which lack the fields) load
  unchanged and resolve to `None`.
- TS: `word_wrap?: boolean | null;` and `indent_guides?: boolean | null;` on the
  `SessionState` interface.

Wire into the existing persistence path (the same module/effect that reads the
workspace and split state into `SessionState` on change, and applies them on boot):
- **Save:** write `useEditorPrefs.getState().wordWrap` / `.indentGuides`.
- **Restore:** if the loaded field is non-null, call `setWordWrap` / `setIndentGuides`;
  if null (old file), leave the store default.

### 4. Triggers

- **Command palette** (`src/commands/builtins.ts`): two new commands —
  `Toggle Word Wrap` → `useEditorPrefs.getState().toggleWordWrap()`, and
  `Toggle Indent Guides` → `useEditorPrefs.getState().toggleIndentGuides()`. Follow
  the existing command entry shape (id, title, run).
- **Keyboard** (the App-level keydown handler that already owns shortcuts like
  Ctrl+Shift+F): `Alt+Z` → `toggleWordWrap`. Guard so it does not fire while a
  modifier-conflicting context is active, matching how existing shortcuts are gated.
- **Status bar** (`src/components/StatusBar.tsx`): a `data-status-segment="wordwrap"`
  button reading "Wrap", bright (`hover:text-neutral-100`, full color) when on and
  dimmed when off, clicking toggles. Shown whenever there is an active buffer
  (consistent with the encoding/EOL segments). Indent guides gets no segment.

### 5. Testing

- **vitest** (`src/tests/editor-prefs.test.ts`): defaults (wordWrap=false,
  indentGuides=true); each toggle/setter; `reset`. Plus a session round-trip test
  (extend or sit beside the existing session-persistence tests): save writes both
  flags; restore applies them; a `SessionState` missing both fields leaves store
  defaults untouched.
- **Rust** (`src-tauri/src/session.rs`): a serde test that deserializing a JSON
  blob without `word_wrap`/`indent_guides` yields `None` (back-compat), and that a
  blob with them set round-trips.
- **e2e** (`tests/e2e/editor-prefs.spec.ts`, release build): open a buffer; run
  "Toggle Word Wrap" (via the command palette or a `__memopad*` hook) and assert
  `.cm-content` gains/loses the `.cm-lineWrapping` class; toggle indent guides and
  assert `.cm-indentation-marker` elements appear/disappear. Mind the alphabetical
  spec-order + sidebar-state-leakage gotchas from prior e2e work.

## Error handling / edge cases

| Case | Handling |
|------|----------|
| Old `session.json` without the fields | `#[serde(default)]` → `None` → store keeps defaults |
| Split view | Both panes read the global store → update together |
| `@replit/...` version vs CM6 | Pin a known-compatible version in the plan; verify `npx tsc` + e2e |
| Reconfigure preserving cursor | `@uiw/react-codemirror` reconfigures in place; cursor/scroll persistence already handled by EditorPane |

## Scope boundaries (YAGNI — explicit non-goals)

- No per-buffer wrap/guide override.
- No per-language defaults.
- No wrap-column / print-margin ruler.
- No configurable indent-guide color, width, or active-line highlighting.
- No keyboard shortcut for indent guides.

## Release

Ships as **0.5.0**. CHANGELOG: Added — word wrap (`Alt+Z` / palette / status-bar "Wrap"
segment) and indent guides (palette), both global and persisted. Version bump in
`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` per the established
release procedure.
