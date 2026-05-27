# Find in Files — v2 Design

Date: 2026-05-27
Status: Approved (awaiting implementation plan)
Predecessor: `2026-05-25-memopad-design.md` (v1 spec; this feature was listed as a non-goal there)

## Goal

Add project-wide search to Memopad: open a folder once, then search across every text file in it from a left sidebar panel, jumping into the editor at any matched line. The feature should feel as snappy as ripgrep on typical project sizes and as familiar as VS Code's search panel.

## Non-goals (this slice)

- **Replace across files.** Destructive and warrants its own slice with a preview/confirm flow.
- **File tree sidebar.** The sidebar shell is introduced here, but the tree itself is a separate v2 slice.
- **Symbol search / fuzzy file open.** Out of scope.
- **Streaming results.** All-at-once with a 10,000-match cap is the v1 of v2 contract.
- **Live cancellation of in-flight Rust searches.** The frontend drops stale responses; the Rust walk runs to completion in the background.
- **Indexed search.** Every query re-walks the folder; no on-disk index.

## Pillars

1. **Persistent workspace folder.** "Open folder" sets a workspace; it survives relaunch via `session.json`.
2. **ripgrep backend.** `grep`, `grep-regex`, `grep-searcher`, and `ignore` crates power the walk and match.
3. **Left sidebar UI.** A new collapsible sidebar hosts the Search panel; the future file tree will share it.

## Architecture

Three layers, each with a clear boundary:

### Rust — `src-tauri/src/search.rs` (new module, ~200 LOC + tests)

One new Tauri command: `find_in_folder(folder, query, opts) -> FindResponse`.

```rust
pub struct FindOptions {
    pub regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
}

pub struct LineMatch {
    pub line_number: u32,
    pub line_text: String,
    pub match_ranges: Vec<(u32, u32)>, // byte offsets within line_text
}

pub struct FileMatch {
    pub path: String,
    pub matches: Vec<LineMatch>,
}

pub struct FindResponse {
    pub files: Vec<FileMatch>,
    pub truncated: bool,
    pub elapsed_ms: u64,
}

pub enum FindError {
    InvalidRegex(String),
    Io(io::Error),
    WorkspaceMissing,
}

pub fn find_in_folder(folder: &Path, query: &str, opts: &FindOptions)
    -> Result<FindResponse, FindError>;
```

Internals:
- Build a `grep_regex::RegexMatcher`. Escape `query` if `!opts.regex`. Wrap in `\b…\b` if `opts.whole_word`. Set `case_insensitive` from `!opts.case_sensitive`.
- Walk with `ignore::WalkBuilder::new(folder).build_parallel()` — respects `.gitignore`, `.ignore`, and hidden-file conventions for free.
- For each file, use `grep_searcher::Searcher` with a custom `Sink` that collects `LineMatch` rows.
- Skip binary files (ripgrep's default detection via `grep_searcher`).
- Cap enforcement: an `AtomicUsize` shared across threads counts matches; once it reaches `10_000`, the sink signals quit and the walk drains. Response is built from whatever was collected, with `truncated: true`.
- At the command boundary in `lib.rs`, the error enum is converted to `String` via `to_string()` (matches the pattern used by `fs::open_file`).

### Frontend store — `src/stores/workspace.ts` (new, ~80 LOC)

A Zustand slice separate from `buffers.ts`:

```ts
interface WorkspaceState {
  workspaceFolder: string | null;
  results: FindResponse | null;
  inFlight: boolean;
  lastQuery: string;
  lastOpts: FindOptions;
  // internal
  requestId: number;

  openFolder(): Promise<void>;
  closeFolder(): void;
  runSearch(query: string, opts: FindOptions): Promise<void>;
  clearResults(): void;
}
```

- `openFolder()` calls `@tauri-apps/plugin-dialog` `open({ directory: true })`, sets state, triggers session save.
- `runSearch()` increments `requestId`, sets `inFlight = true`, invokes `find_in_folder`, and drops the response if `requestId` has moved on (stale-drop cancellation).
- The existing session-save subscription is extended to include `workspaceFolder` in its payload (a new field on `session::SessionState`).

### Frontend UI — two new components, plus small TitleBar / SearchPanel changes

- **`src/components/Sidebar.tsx`** (~60 LOC) — fixed-width flex column (default 280px), collapsible via `view.toggleSidebar`. Hosts `<SearchPanel />`. Empty state when `workspaceFolder` is null: "Open a folder to search across files" + a button that calls `workspace.openFolder`.

- **`src/components/SearchPanel.tsx`** (~150 LOC) — top: query `<input>` + three toggles (`Aa`, `.*`, `\b…\b`); middle: results grouped by file path, each match a clickable row showing `{line}: {snippet}` with the match range highlighted; bottom: status line (`"12 matches in 5 files"` / `"10,000+ matches — refine your query"`).

- **`src/components/TitleBar.tsx`** — add a sidebar-toggle icon button.

### Buffers store addition — `src/stores/buffers.ts`

One new action:

```ts
openFileAtLine(path: string, line: number, range: [number, number]): Promise<void>
```

If the path is already an open tab, switch to it. Otherwise call existing `fs::open_file`, add a buffer, switch to it. After the editor mounts/updates, dispatch a CodeMirror transaction that sets the selection to the match range, scrolls into view, and applies a transient flash decoration that fades after 600ms.

### Commands and keybindings — `src/commands/builtins.ts`

| Command id | Default binding | Behavior |
| --- | --- | --- |
| `workspace.openFolder` | `Ctrl+K Ctrl+O` | dialog → set workspace |
| `workspace.closeFolder` | — | clears workspace folder |
| `search.focusFindInFiles` | `Ctrl+Shift+F` | opens sidebar, focuses input |
| `view.toggleSidebar` | `Ctrl+B` | shows/hides sidebar |

## Data flow

### Opening a folder

1. User runs `workspace.openFolder` (palette or `Ctrl+K Ctrl+O`).
2. `useWorkspace.openFolder()` calls `dialog.open({ directory: true })`.
3. Store sets `workspaceFolder`. Session-save subscription writes it to `session.json`.
4. Sidebar re-renders; empty state replaced by SearchPanel.
5. On next launch, `session_load` returns the folder; store rehydrates on app boot.

### Running a search

1. User types in SearchPanel input. A 200ms debounce fires `runSearch(query, opts)`.
2. Store increments `requestId`, sets `inFlight = true`, clears stale `results`.
3. Frontend invokes `find_in_folder(folder, query, opts)` Tauri command.
4. Rust builds matcher → parallel walk → collects matches → returns `FindResponse`.
5. Store checks `requestId` matches; if so, sets `results`, clears `inFlight`. SearchPanel renders the result tree.

### Cancellation (stale-drop)

A new search supersedes an in-flight one purely on the frontend: the store tracks a `requestId` counter; results arriving with a stale id are dropped. No cancellation signal to Rust in this slice. Acceptable because the 10,000-match cap bounds total work. A fast-typing user can stack ~5 background walks; each caps quickly and is GC'd by the OS.

### Jumping to a match

1. User clicks a match row.
2. SearchPanel calls `buffers.openFileAtLine(path, line, range)`.
3. If path is already an open tab, switch to it; else call `fs::open_file`, add a new buffer, switch.
4. After the editor mounts/updates, dispatch a CodeMirror transaction to set selection to the match range, scroll into view, and apply a transient flash decoration (fades after 600ms).

### Persistence boundary

Only `workspaceFolder` persists. Search results, query, and toggle state are session-memory only — closing the app clears them.

## Error handling

| Scenario | Behavior |
| --- | --- |
| Invalid regex | `grep_regex::RegexMatcher::new()` errors → `FindError::InvalidRegex(msg)` → inline red error under the input; results pane stays empty (no stale results shown). |
| Workspace folder deleted / inaccessible | `WalkBuilder` errors on the root → `FindError::WorkspaceMissing` → UI shows "Folder no longer accessible — open another folder" with an open-folder button. The persisted folder is NOT silently cleared (might be an unmounted drive). |
| File read errors mid-walk | `ignore::Walk` gives per-entry errors → logged via `eprintln!` and skipped. No user-facing error. |
| Empty / whitespace-only query | SearchPanel does not invoke the command. Results cleared. |
| Match overflow (10,000 cap) | `FindResponse.truncated = true` → status line "10,000+ matches — refine your query" in warning color. Results still shown. |
| Jump-to-match on missing file | Existing `fs::open_file` error path fires (current convention). Search results stay open. |

## Testing

### Rust — `src-tauri/src/search.rs` (target ~8–10 new tests)

- `finds_literal_match_in_single_file`
- `respects_gitignore`
- `case_sensitive_toggle`
- `regex_toggle_escapes_literals`
- `whole_word_toggle`
- `invalid_regex_returns_error`
- `truncates_at_10k_matches`
- `skips_binary_files`
- `workspace_missing_returns_error`

### Vitest — `src/tests/workspace.test.ts` (target ~5 new cases)

- `openFolder_persists_to_session`
- `runSearch_sets_inFlight_then_clears`
- `runSearch_drops_stale_response`
- `runSearch_with_empty_query_is_noop`
- `openFileAtLine_reuses_existing_tab`

### WebdriverIO e2e — `e2e/specs/find-in-files.spec.ts` (target 3 tests)

- `opens_folder_via_palette_and_search_panel_renders`
- `searches_and_renders_results`
- `click_match_opens_file_at_line`

Fixture folder at `e2e/fixtures/workspace/` with a few small files containing known matchable strings.

### Gates to ship the slice

- All existing tests still pass (vitest 50 → ~55, cargo 51 → ~60, e2e 45 → 48)
- `tsc --noEmit` clean
- Manual smoke: open Memopad's own source folder, search for "buffer", click a result, see the editor jump to the right line

## Risks and open questions

- **Sidebar layout reflow.** The editor area is currently the only top-level flex child below TitleBar; introducing a left sibling needs the editor child to remain `flex-1 w-full` or it collapses (see the Phase 4 layout-invariant bugs documented in CLAUDE-style notes). Will need a corresponding e2e layout-invariant test.
- **Session schema migration.** Adding `workspaceFolder` to `SessionState` must remain backward-compatible — `serde(default)` on the new field; old session.json files load with `workspaceFolder: None`.
- **Binary size.** The ripgrep crate family adds ~1.5 MB to the release MSI. Acceptable given the 5.62 MB baseline.
- **Path handling on Windows.** Tauri returns paths with backslashes; the SearchPanel must display them consistently and pass them back to `fs::open_file` unchanged.
