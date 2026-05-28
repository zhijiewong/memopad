# Replace in Files — v2 Slice 3 Design

Date: 2026-05-28
Status: Approved (awaiting implementation plan)
Predecessors:
- `2026-05-27-find-in-files-design.md` (slice 1; introduced workspace folder + Search panel + find_in_folder Rust command)
- `2026-05-28-file-tree-design.md` (slice 2; introduced Sidebar tabs + file tree)

## Goal

Add a replace input to the existing Search panel so a user who's already run a find can rewrite every match across every file in one shot. A confirm dialog gates the destructive write; dirty buffers block the action. The applied replacement preserves each file's original encoding via the same atomic tmp+rename pattern that powers `fs::save_file`.

## Non-goals (this slice)

- **Per-match or per-file checkboxes.** Replace is all-or-nothing per the current find results.
- **In-app undo of a completed replace.** Once written, changes are persisted. (Users can `git diff` or `Ctrl+Z` per open buffer afterwards.)
- **Rollback across files on partial failure.** Best-effort: successes are kept; failures surface in a per-file outcome list.
- **Background / streaming application.** The Tauri command runs to completion before returning. For 10,000-match workspaces this is acceptable (the same cap that bounds find).
- **Replace with file-path or filename rewrites.** Content only.

## Pillars

1. **Reuse the find pipeline.** Replace uses the same regex matcher build path as `find_in_folder` (literal-escape, whole-word wrap, case_insensitive toggle). Identical search semantics → no surprises.
2. **Atomic per-file writes.** Each file is replaced via tmp+rename, matching the existing `fs::save_file` pattern. Encoding is preserved per file.
3. **Confirm before apply.** A modal dialog shows the match count and (if any) the dirty-buffer block list.
4. **Refresh after apply.** Successful replaces trigger a fresh `runSearch` (so the panel updates to zero or fewer matches) and reload any open buffers for changed files.

## Architecture

### Rust — `src-tauri/src/search.rs` additions (~120 LOC + tests)

New types and function alongside the existing `find_in_folder`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileResult {
    pub path: String,
    pub matches_replaced: u32,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReplaceResponse {
    pub results: Vec<FileResult>,
    pub total_files_replaced: u32,
    pub total_matches_replaced: u32,
}

pub fn replace_in_files(
    folder: &Path,
    query: &str,
    replacement: &str,
    opts: &FindOptions,
    target_paths: Option<&[String]>,
) -> Result<ReplaceResponse, FindError>;
```

Internals:
- Extract a private `build_matcher_pattern(query, opts) -> Result<String, FindError>` from the existing `find_in_folder` body (escape literal, wrap `\b…\b`, set case_insensitive). Both `find_in_folder` and `replace_in_files` call it.
- Build a `regex::Regex` (NOT `grep_regex::RegexMatcher`) from that pattern with `RegexBuilder::case_insensitive(!opts.case_sensitive)`. We need `Regex::replace_all` which lives in the `regex` crate proper.
- For each file in `target_paths` (or, when None, every file produced by the same `ignore::WalkBuilder` walk find uses):
  - `std::fs::read(path)` to get bytes.
  - Detect encoding via the existing `fs::detect_encoding`; decode via `fs::decode_bytes`.
  - `match_count = re.find_iter(&text).count() as u32`.
  - If `match_count == 0`, push `FileResult { matches_replaced: 0, error: None }` and skip writing.
  - Else `new_content = re.replace_all(&text, replacement).into_owned()`.
  - Encode via `fs::encode_string(&new_content, encoding)`, write to `<path>.tmp`, `sync_all`, rename. On any IO error, capture as `FileResult { error: Some(msg), matches_replaced: 0 }` and continue.
- Tally `total_files_replaced` (entries with `matches_replaced > 0 && error.is_none()`) and `total_matches_replaced`.

Tauri command (in `lib.rs`):

```rust
#[tauri::command]
fn replace_in_files(
    folder: String,
    query: String,
    replacement: String,
    opts: search::FindOptions,
    target_paths: Option<Vec<String>>,
) -> Result<search::ReplaceResponse, String> {
    search::replace_in_files(
        std::path::Path::new(&folder),
        &query,
        &replacement,
        &opts,
        target_paths.as_deref(),
    ).map_err(|e| e.to_string())
}
```

### Frontend store — `src/stores/workspace.ts` additions

```ts
replaceInFlight: boolean;

replaceInFiles(replacement: string): Promise<ReplaceResponse>;
```

Behavior:
- Early-return an empty response if `!workspaceFolder` or `!results` or `lastQuery.trim() === ''`.
- `target_paths = results.files.map((f) => f.path)`.
- Set `replaceInFlight = true`, invoke the IPC.
- On resolve, set `replaceInFlight = false`.
- Call `runSearch(lastQuery, lastOpts)` to refresh.
- For each `r` in `response.results` where `r.error == null && r.matches_replaced > 0`, call `useBuffers.getState().reloadIfOpen(r.path)`.
- Return the response (caller renders the summary).

### Buffers store — new action

```ts
reloadIfOpen(path: string): Promise<void>;
```

- Find buffer with matching `path`. If absent OR `dirty === true`, return.
- Re-read via `openFile(path)` IPC. Call existing `replaceBuffer(id, opened)` (preserves id; cursor/scroll preserved via existing per-buffer fields).
- Errors swallowed (best-effort).

### Frontend UI

**`src/components/SearchPanel.tsx` modifications:**
- New state `const [replace, setReplace] = useState('')` and `const [replaceVisible, setReplaceVisible] = useState(false)`.
- `↔` icon button next to the find input toggles `replaceVisible`.
- When `replaceVisible`, render a second input below find:
  ```tsx
  <input
    data-testid="replace-input"
    type="text"
    value={replace}
    onChange={(e) => setReplace(e.target.value)}
    placeholder="Replace"
    className="flex-1 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
  />
  ```
- `Snippet` accepts an optional `replacement?: string` prop. When defined, renders each match as `<s>{old}</s><mark>{new_after_substitution}</mark>` where `new_after_substitution` is computed client-side from the same regex (applied to `line_text` against `match_ranges`). When undefined, falls back to single-highlight rendering.
- Status bar: when `replaceVisible && results.files.length > 0`, the existing status text is followed by a `<button data-testid="replace-all">Replace All</button>` (button label changes to `Replace All in N files`).
- Clicking Replace All opens `<ReplaceConfirmDialog />` with the current `replace` value passed as a prop.

**`src/components/ReplaceConfirmDialog.tsx`** (new, ~80 LOC)

Props: `{ replacement: string; onClose(): void }`. Reads `results`, `lastQuery`, `lastOpts`, `replaceInFiles` from `useWorkspace`; reads `buffers` from `useBuffers`.

State machine inside the dialog:
- `idle` — show confirm or blocked content depending on dirty conflicts.
- `inFlight` — Replace button disabled, shows "Replacing…".
- `done` — show summary; either auto-close 1.5s if all succeeded, or stay open with OK button if any per-file errors.

Render branches:
- **Dirty-blocked:** if `useBuffers.getState().buffers.some((b) => b.dirty && b.path && targetPaths.includes(b.path))`, render:
  ```
  Unsaved changes in:
   • notes.txt
   • code.rs
  Save or revert these files first.
  [Close]
  ```
  No Replace button.
- **Confirm:** render `Replace {n_matches} matches in {n_files} files?` (or `Delete {n_matches} matches in {n_files} files?` if `replacement === ''`). Cancel + Replace buttons.
- **Summary (success):** `Replaced {total_matches_replaced} in {total_files_replaced} files.` Closes after 1.5s.
- **Summary (partial failure):** `Replaced X/Y files. Failed: foo.rs (permission denied), bar.tsx (file not found)`. OK button.

### Commands and keybindings

No new commands or keybindings. The replace input is reached through the existing Search panel UI. `Ctrl+H` could plausibly toggle the replace input in the future, but it's already bound to the in-editor SearchStrip's replace mode (which is unchanged). To avoid confusion, this slice does NOT add a global shortcut — users click `↔` or tab into the replace input from the find input.

## Data flow

### Typing in the replace input
1. User clicks `↔` to reveal replace input.
2. User types. Local `replace` state updates each keystroke.
3. NO new IPC call — preview is purely client-side regex applied over each `LineMatch.line_text`.
4. Each match in the results re-renders as `<s>old</s><mark>new</mark>`.
5. Status row changes from match count to `[count] [Replace All in N files]`.

### Apply
1. User clicks Replace All.
2. `<ReplaceConfirmDialog />` mounts with `replacement={replace}` prop.
3. Dialog inspects `useBuffers.getState().buffers` and the current `results.files.map((f) => f.path)` to decide between blocked / confirm variant.
4. **Confirm path:** user clicks Replace.
   - Dialog sets local `inFlight`.
   - Calls `useWorkspace.getState().replaceInFiles(replacement)`.
   - Store sets `replaceInFlight`, invokes the Tauri command, awaits.
   - On resolve: store clears `replaceInFlight`, calls `runSearch(lastQuery, lastOpts)`, then iterates `response.results` calling `useBuffers.getState().reloadIfOpen(path)` for each success.
   - Dialog reads the resolved response and renders the summary branch.
5. **Auto-close path:** all errors are None → wait 1.5s → unmount.
6. **Sticky path:** at least one error → render the failure list + OK; unmount when user clicks OK.

### Cancellation
- Pre-confirm: clicking Cancel unmounts the dialog. No backend call.
- Mid-write: no cancellation token. Acceptable — typical workspaces finish in seconds.

### Empty replace
- `replacement === ''` is legitimate ("delete every `console.log()` call"). Confirm copy switches to `Delete {n_matches} matches in {n_files} files?`.

### After a successful replace
- The follow-up `runSearch` runs the same query; since the matches were removed, results.files is empty or smaller. The panel updates naturally.
- Each open buffer for a replaced file is re-read via `reloadIfOpen`. Cursor + scroll preserved by `replaceBuffer`.

## Error handling

| Scenario | Behavior |
| --- | --- |
| Invalid regex | Caught at search time; never reaches replace (Replace All button is hidden when `results.error != null`). |
| File deleted between search and replace | `std::fs::read` fails → `FileResult { error: Some("…"), matches_replaced: 0 }`. Surfaced in dialog summary. |
| File became read-only / permission denied | `File::create(tmp)` or `rename` fails → captured as per-file error. Surfaced. |
| `.tmp` written but rename fails | The `.tmp` file is left on disk (matches `fs::save_file`'s existing behavior). Original file unchanged. Per-file error surfaced. |
| Binary file in walker | Already skipped at find time via `BinaryDetection::quit(0)`. Never in `target_paths`. |
| File edited externally between search and replace | `re.find_iter(text).count() == 0` → `FileResult { matches_replaced: 0, error: None }`. Counted in summary as "had no matches at replace time" — folded into the summary copy. |
| Dirty buffer for target file | Blocked before invoke. Dialog shows dirty list. No backend call. |
| `replaceInFiles` invoked with no current results | Store returns an empty response; SearchPanel hides the button when `results.files.length === 0`. Defensive only. |
| `closeFolder` mid-replace | Store does NOT abort the in-flight replace. When IPC resolves, the post-write `runSearch` sees no workspace and returns early; dialog still surfaces the per-file outcome list normally. |
| `reloadIfOpen` for a file that was just deleted | Swallows error silently. Buffer keeps pre-replace content. |
| Regex backreferences in replacement | `regex::Regex::replace_all` supports `$1`, `$2`. With regex toggle ON they work as expected. With regex toggle OFF the find pattern is `regex::escape`d so there are no capture groups; backrefs in the replacement pass through literally. |

## Testing

### Rust — `src-tauri/src/search.rs` additions (target 7 tests)

- `replace_literal_replaces_all_matches_in_a_file`
- `replace_respects_case_sensitive_toggle`
- `replace_respects_whole_word_toggle`
- `replace_with_regex_backreferences`
- `replace_preserves_encoding_utf16_le`
- `replace_skips_targets_with_no_match`
- `replace_records_per_file_io_errors`

### Vitest — `src/tests/workspace-replace.test.ts` (target 4 cases)

- `replaceInFiles_uses_lastQuery_and_lastOpts`
- `replaceInFiles_skips_when_no_results`
- `replaceInFiles_reloads_open_buffers_for_replaced_files`
- `replaceInFiles_re-runs_search_after_completion`

### Vitest — `src/tests/buffers.test.ts` (add 1 case)

- `reloadIfOpen_replaces_content_and_preserves_id`

### WebdriverIO e2e — `tests/e2e/replace-in-files.spec.ts` (target 2 tests)

The spec copies `tests/e2e/fixtures/workspace/` to a temp dir at start so writes don't mutate the checked-in fixture across runs.

- `replace_all_rewrites_matches_and_refreshes_results`
- `dirty_buffer_blocks_replace_with_warning`

### Gates to ship

- vitest: 61 → ~66 (target +4 workspace-replace + 1 buffers)
- cargo test: 70 → ~77 (target +7 replace)
- e2e: 7 → 9 (target +2 replace)
- `tsc --noEmit` clean
- Manual smoke: replace in a throwaway scratch folder, inspect resulting files.

## Risks and open questions

- **Regex semantics divergence.** We use `grep_regex::RegexMatcher` for find and `regex::Regex` for replace. Both compile from the same syntax via the `regex-syntax` crate underneath, but `grep_regex` ships with `multi_line: true` by default for line-oriented matching, while `regex::Regex` defaults to single-line. The `(?m)` inline flag and `RegexBuilder::multi_line(true)` would align them. The replace path matches against full file content (not line-by-line), so multiline matching by default is correct for replace. Worth a unit test where the query starts at one position and the replacement spans line breaks — though that's an edge case the v1 user won't normally hit. **Decision:** leave defaults as-is; if a user reports drift, add `multi_line(true)` to the replace regex builder.
- **Performance on huge folders.** With the 10,000-match cap from find, the target_paths set is bounded. Reading + rewriting up to ~1,000 files (typical worst case) in serial takes seconds, not minutes. Acceptable. If profiling later shows it's a problem, parallelize via Rayon — but YAGNI for now.
- **Confirm dialog "Delete" vs "Replace" copy.** The empty-replacement case says "Delete N matches" which is technically inaccurate — we replace with empty, we don't delete entire matches in a destructive sense. Going with "Delete" because it's more honest about the user-visible effect (text disappears). If users find it scary, soften to "Replace N matches with empty string".
- **No undo.** This is the right call for v1 but will surface in user feedback. The escape hatch — open the affected files and ctrl+z per file — works because each replaced file is reloaded into its buffer (if open) AFTER write, so any open buffer's undo history doesn't include the replace transition. Users who want undo will have to use git. Acceptable trade-off; revisit if real users push back.
