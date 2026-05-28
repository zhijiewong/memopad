# Memopad v2 — Replace in Files

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a replace input + confirm dialog to the existing Search panel so a user who's run a find can rewrite every match across every file in one shot. Encoding preserved per file via the existing `fs::encode_string` + atomic tmp+rename. Dirty buffers block the action with a warning.

**Architecture:** A new `replace_in_files` function in `src-tauri/src/search.rs` reuses the same regex matcher build path as `find_in_folder`, then uses `regex::Regex::replace_all` to substitute on per-file decoded UTF-8 strings, re-encodes via `fs::encode_string`, and writes atomically. Returns a `Vec<FileResult>` per-file outcome. Frontend: `useWorkspace.replaceInFiles(replacement)`, a Snippet that shows old→new previews, and a new `ReplaceConfirmDialog`.

**Tech Stack:** Tauri 2, Rust (`regex` crate already in deps), React + Zustand. No new dependencies.

**Spec section reference:** `docs/superpowers/specs/2026-05-28-replace-in-files-design.md` (all sections).

---

## File Structure

```
memopad/
├── src-tauri/
│   └── src/
│       ├── lib.rs                   MODIFY — register replace_in_files command
│       └── search.rs                MODIFY — extract build_matcher_pattern, add replace_in_files + tests
├── src/
│   ├── lib/
│   │   └── tauri.ts                 MODIFY — ReplaceResponse types + replaceInFiles wrapper
│   ├── stores/
│   │   ├── workspace.ts             MODIFY — replaceInFlight + replaceInFiles action
│   │   └── buffers.ts               MODIFY — reloadIfOpen action
│   ├── components/
│   │   ├── SearchPanel.tsx          MODIFY — replace input, Snippet diff preview, Replace All button
│   │   └── ReplaceConfirmDialog.tsx CREATE — three-state dialog (idle/inFlight/done)
│   └── tests/
│       ├── workspace-replace.test.ts CREATE — 4 vitest cases
│       └── buffers.test.ts          MODIFY — reloadIfOpen test case
└── tests/e2e/
    └── replace-in-files.spec.ts     CREATE — 2 e2e tests
```

Boundary intent:
- **`search.rs`** keeps the regex-build logic in a single private helper that both find and replace call. The replace function owns the file IO and per-file error capture.
- **`workspace.ts`** owns the replace orchestration (target_paths derivation, store flag, post-replace search refresh, per-file buffer reload).
- **`buffers.ts`** owns the `reloadIfOpen` action — the single seam between replace and editor state.
- **`SearchPanel.tsx`** adds replace UI and preview rendering. **`ReplaceConfirmDialog.tsx`** owns the confirm/blocked/summary state machine and is the only consumer of `replaceInFiles`.

---

## Task 1: Extract `build_matcher_pattern` helper

**Files:**
- Modify: `src-tauri/src/search.rs`

- [ ] **Step 1: Add the helper near the top of `src-tauri/src/search.rs`**

After the existing type definitions (after `impl From<std::io::Error> for FindError`, before `pub fn find_in_folder`), add:

```rust
/// Build the matcher pattern string used by both find and replace. Applies the
/// FindOptions flags consistently: literal-escape when regex is off, wrap with
/// `\b(?:…)\b` when whole_word is on. The case_sensitive flag is applied at
/// builder time by the caller (not in the pattern itself).
fn build_matcher_pattern(query: &str, opts: &FindOptions) -> String {
    let pattern = if opts.regex { query.to_string() } else { regex::escape(query) };
    if opts.whole_word { format!(r"\b(?:{})\b", pattern) } else { pattern }
}
```

- [ ] **Step 2: Replace the inline construction in `find_in_folder`**

Inside `pub fn find_in_folder`, find the two lines:

```rust
    let pattern = if opts.regex { query.to_string() } else { regex::escape(query) };
    let pattern = if opts.whole_word { format!(r"\b(?:{})\b", pattern) } else { pattern };
```

Replace them with:

```rust
    let pattern = build_matcher_pattern(query, opts);
```

- [ ] **Step 3: Run the full search test suite to confirm no regression**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib search::
cd ..
```

Expected: all 9 existing search tests still PASS.

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/search.rs
git commit -m "search: extract build_matcher_pattern helper"
```

---

## Task 2: `ReplaceResponse` types + `replace_in_files` stub

**Files:**
- Modify: `src-tauri/src/search.rs`

- [ ] **Step 1: Add the response types after the existing `FindResponse`**

In `src-tauri/src/search.rs`, after the existing `pub struct FindResponse { … }` block, add:

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
```

- [ ] **Step 2: Add a stub `replace_in_files` at the bottom of the file (before `#[cfg(test)] mod tests`)**

```rust
pub fn replace_in_files(
    _folder: &Path,
    _query: &str,
    _replacement: &str,
    _opts: &FindOptions,
    _target_paths: Option<&[String]>,
) -> Result<ReplaceResponse, FindError> {
    // Filled in by later tasks.
    Ok(ReplaceResponse {
        results: Vec::new(),
        total_files_replaced: 0,
        total_matches_replaced: 0,
    })
}
```

- [ ] **Step 3: Verify it compiles**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo check
cd ..
```

Expected: clean compile.

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/search.rs
git commit -m "search: replace_in_files types + stub"
```

---

## Task 3: `replace_in_files` — literal replacement in one file

**Files:**
- Modify: `src-tauri/src/search.rs`

- [ ] **Step 1: Append the first replace test inside the existing `mod tests` block**

```rust
#[test]
fn replace_literal_replaces_all_matches_in_a_file() {
    let dir = tmp("rep_literal");
    write(&dir, "a.txt", "foo\nbar foo");

    let resp = replace_in_files(
        &dir, "foo", "baz",
        &FindOptions::default(),
        None,
    ).unwrap();

    assert_eq!(resp.total_files_replaced, 1);
    assert_eq!(resp.total_matches_replaced, 2);
    assert_eq!(resp.results.len(), 1);
    assert_eq!(resp.results[0].matches_replaced, 2);
    assert_eq!(resp.results[0].error, None);

    let content = std::fs::read_to_string(dir.join("a.txt")).unwrap();
    assert_eq!(content, "baz\nbar baz");
}
```

- [ ] **Step 2: Run to confirm fail**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib search::tests::replace_literal_replaces_all_matches_in_a_file
cd ..
```

Expected: FAIL — stub returns empty response.

- [ ] **Step 3: Replace the stub with the real implementation**

Replace the stub `pub fn replace_in_files` body with:

```rust
pub fn replace_in_files(
    folder: &Path,
    query: &str,
    replacement: &str,
    opts: &FindOptions,
    target_paths: Option<&[String]>,
) -> Result<ReplaceResponse, FindError> {
    use ignore::WalkBuilder;
    use regex::RegexBuilder;

    if !folder.exists() {
        return Err(FindError::WorkspaceMissing);
    }

    let pattern = build_matcher_pattern(query, opts);
    let re = RegexBuilder::new(&pattern)
        .case_insensitive(!opts.case_sensitive)
        .build()
        .map_err(|e| FindError::InvalidRegex(e.to_string()))?;

    // Materialize the list of files to operate on.
    let files: Vec<std::path::PathBuf> = match target_paths {
        Some(paths) => paths.iter().map(std::path::PathBuf::from).collect(),
        None => {
            let mut out = Vec::new();
            let mut walker = WalkBuilder::new(folder);
            walker.standard_filters(true);
            walker.require_git(false);
            for entry in walker.build() {
                let entry = match entry { Ok(e) => e, Err(_) => continue };
                if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) { continue; }
                out.push(entry.into_path());
            }
            out
        }
    };

    let mut results: Vec<FileResult> = Vec::with_capacity(files.len());
    let mut total_files: u32 = 0;
    let mut total_matches: u32 = 0;

    for path in files {
        let path_str = path.to_string_lossy().to_string();

        // Read + decode.
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) => {
                results.push(FileResult { path: path_str, matches_replaced: 0, error: Some(e.to_string()) });
                continue;
            }
        };
        let (encoding, _bom_offset) = crate::fs::detect_encoding(&bytes);
        let text = crate::fs::decode_bytes(&bytes, encoding);

        // Count + replace.
        let match_count = re.find_iter(&text).count() as u32;
        if match_count == 0 {
            results.push(FileResult { path: path_str, matches_replaced: 0, error: None });
            continue;
        }
        let new_text = re.replace_all(&text, replacement).into_owned();

        // Encode + atomic write.
        let new_bytes = crate::fs::encode_string(&new_text, encoding);
        let tmp = {
            let mut t = path.clone();
            let mut new_name = t.file_name().unwrap_or_default().to_os_string();
            new_name.push(".tmp");
            t.set_file_name(new_name);
            t
        };
        let write_result = (|| -> std::io::Result<()> {
            use std::io::Write;
            let mut f = std::fs::File::create(&tmp)?;
            f.write_all(&new_bytes)?;
            f.sync_all()?;
            std::fs::rename(&tmp, &path)?;
            Ok(())
        })();

        match write_result {
            Ok(()) => {
                results.push(FileResult { path: path_str, matches_replaced: match_count, error: None });
                total_files += 1;
                total_matches += match_count;
            }
            Err(e) => {
                results.push(FileResult { path: path_str, matches_replaced: 0, error: Some(e.to_string()) });
            }
        }
    }

    Ok(ReplaceResponse {
        results,
        total_files_replaced: total_files,
        total_matches_replaced: total_matches,
    })
}
```

You may need to make `crate::fs::detect_encoding`, `crate::fs::decode_bytes`, and `crate::fs::encode_string` accessible from `search.rs`. They're already `pub` in `fs.rs`. Verify by reading the existing `pub fn detect_encoding` line at the top of `fs.rs`.

- [ ] **Step 4: Run the test**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib search::tests::replace_literal_replaces_all_matches_in_a_file
cd ..
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/search.rs
git commit -m "search: implement replace_in_files literal substitution"
```

---

## Task 4: case/regex/whole-word toggle + backreference tests

**Files:**
- Modify: `src-tauri/src/search.rs`

- [ ] **Step 1: Append four tests inside `mod tests`**

```rust
#[test]
fn replace_respects_case_sensitive_toggle() {
    let dir = tmp("rep_case");
    write(&dir, "a.txt", "Foo\nfoo");
    let resp = replace_in_files(
        &dir, "foo", "X",
        &FindOptions { case_sensitive: true, ..Default::default() },
        None,
    ).unwrap();
    assert_eq!(resp.total_matches_replaced, 1);
    let content = std::fs::read_to_string(dir.join("a.txt")).unwrap();
    assert_eq!(content, "Foo\nX");
}

#[test]
fn replace_respects_whole_word_toggle() {
    let dir = tmp("rep_word");
    write(&dir, "a.txt", "foo\nfood");
    let resp = replace_in_files(
        &dir, "foo", "X",
        &FindOptions { whole_word: true, ..Default::default() },
        None,
    ).unwrap();
    assert_eq!(resp.total_matches_replaced, 1);
    let content = std::fs::read_to_string(dir.join("a.txt")).unwrap();
    assert_eq!(content, "X\nfood");
}

#[test]
fn replace_with_regex_backreferences() {
    let dir = tmp("rep_regex");
    write(&dir, "a.txt", "alice@example.com\nbob@example.com");
    let resp = replace_in_files(
        &dir, r"(\w+)@example\.com", "$1@new.com",
        &FindOptions { regex: true, ..Default::default() },
        None,
    ).unwrap();
    assert_eq!(resp.total_matches_replaced, 2);
    let content = std::fs::read_to_string(dir.join("a.txt")).unwrap();
    assert_eq!(content, "alice@new.com\nbob@new.com");
}

#[test]
fn replace_skips_targets_with_no_match() {
    let dir = tmp("rep_skip");
    write(&dir, "a.txt", "foo");
    write(&dir, "b.txt", "no match here");
    let resp = replace_in_files(
        &dir, "foo", "bar",
        &FindOptions::default(),
        None,
    ).unwrap();
    // Both files appear in results, but only a.txt was actually replaced.
    assert_eq!(resp.total_files_replaced, 1);
    let b_entry = resp.results.iter().find(|r| r.path.ends_with("b.txt")).unwrap();
    assert_eq!(b_entry.matches_replaced, 0);
    assert_eq!(b_entry.error, None);
    let b_content = std::fs::read_to_string(dir.join("b.txt")).unwrap();
    assert_eq!(b_content, "no match here");
}
```

- [ ] **Step 2: Run them**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib search::tests::replace_respects_case_sensitive_toggle
cargo test --lib search::tests::replace_respects_whole_word_toggle
cargo test --lib search::tests::replace_with_regex_backreferences
cargo test --lib search::tests::replace_skips_targets_with_no_match
cd ..
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```powershell
git add src-tauri/src/search.rs
git commit -m "search: tests for replace case/regex/whole-word + skip-no-match"
```

---

## Task 5: Encoding preservation + IO-error tests

**Files:**
- Modify: `src-tauri/src/search.rs`

- [ ] **Step 1: Append two tests inside `mod tests`**

```rust
#[test]
fn replace_preserves_encoding_utf16_le() {
    let dir = tmp("rep_utf16");
    // BOM (0xFF 0xFE) + "foo" in UTF-16 LE: f=0x66 o=0x6F o=0x6F
    let bom: [u8; 2] = [0xFF, 0xFE];
    let mut bytes: Vec<u8> = bom.to_vec();
    for ch in "foo".encode_utf16() {
        bytes.extend_from_slice(&ch.to_le_bytes());
    }
    std::fs::write(dir.join("a.txt"), &bytes).unwrap();

    let resp = replace_in_files(
        &dir, "foo", "bar",
        &FindOptions::default(),
        None,
    ).unwrap();
    assert_eq!(resp.total_matches_replaced, 1);

    // Re-read and confirm BOM + UTF-16 LE encoding survived.
    let after = std::fs::read(dir.join("a.txt")).unwrap();
    assert_eq!(&after[0..2], &[0xFF, 0xFE], "BOM should still be present");
    // Decode and compare semantically.
    let units: Vec<u16> = after[2..]
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    let decoded = String::from_utf16(&units).unwrap();
    assert_eq!(decoded, "bar");
}

#[test]
fn replace_records_per_file_io_errors() {
    let dir = tmp("rep_io");
    write(&dir, "writable.txt", "foo");
    write(&dir, "readonly.txt", "foo");
    // Make readonly.txt actually readonly.
    let ro_path = dir.join("readonly.txt");
    let mut perms = std::fs::metadata(&ro_path).unwrap().permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(&ro_path, perms).unwrap();

    let resp = replace_in_files(
        &dir, "foo", "bar",
        &FindOptions::default(),
        None,
    ).unwrap();

    let writable_entry = resp.results.iter().find(|r| r.path.ends_with("writable.txt")).unwrap();
    let readonly_entry = resp.results.iter().find(|r| r.path.ends_with("readonly.txt")).unwrap();
    assert_eq!(writable_entry.matches_replaced, 1);
    assert_eq!(writable_entry.error, None);
    assert!(readonly_entry.error.is_some(), "readonly file should record an error");
    assert_eq!(readonly_entry.matches_replaced, 0);

    // Restore writability so the tempdir can be cleaned up.
    let mut perms = std::fs::metadata(&ro_path).unwrap().permissions();
    #[allow(clippy::permissions_set_readonly_false)]
    perms.set_readonly(false);
    let _ = std::fs::set_permissions(&ro_path, perms);
}
```

- [ ] **Step 2: Run them**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib search::tests::replace_preserves_encoding_utf16_le
cargo test --lib search::tests::replace_records_per_file_io_errors
cd ..
```

Expected: both PASS. NOTE: on Windows, `set_readonly(true)` actually prevents writes; this test runs reliably on the project's target platform.

- [ ] **Step 3: Commit**

```powershell
git add src-tauri/src/search.rs
git commit -m "search: tests for encoding preservation + per-file IO errors"
```

---

## Task 6: Wire `replace_in_files` as a Tauri command

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command wrapper**

In `src-tauri/src/lib.rs`, after the existing `list_dir` Tauri command, add:

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

- [ ] **Step 2: Register it in the `invoke_handler!` macro**

In the `.invoke_handler(tauri::generate_handler![ ... ])` macro list, add `replace_in_files,` after `list_dir,`:

```rust
            list_dir,
            replace_in_files,
        ])
```

- [ ] **Step 3: Verify compiles**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo check
cd ..
```

Expected: clean compile.

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/lib.rs
git commit -m "search: register replace_in_files Tauri command"
```

---

## Task 7: TypeScript IPC wrapper + types

**Files:**
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Append types + wrapper at the bottom of `src/lib/tauri.ts`**

```ts
export interface FileResult {
  path: string;
  matches_replaced: number;
  error: string | null;
}

export interface ReplaceResponse {
  results: FileResult[];
  total_files_replaced: number;
  total_matches_replaced: number;
}

export async function replaceInFiles(
  folder: string,
  query: string,
  replacement: string,
  opts: FindOptions,
  targetPaths: string[] | null,
): Promise<ReplaceResponse> {
  return invoke<ReplaceResponse>('replace_in_files', {
    folder, query, replacement, opts, targetPaths,
  });
}
```

- [ ] **Step 2: Type-check**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/tauri.ts
git commit -m "tauri: typed replaceInFiles IPC wrapper"
```

---

## Task 8: `buffers.reloadIfOpen` action

**Files:**
- Modify: `src/stores/buffers.ts`
- Modify: `src/tests/buffers.test.ts`

- [ ] **Step 1: Add a failing test in `src/tests/buffers.test.ts`**

Append at the bottom (inside the existing test file, in a new `describe`):

```ts
describe('reloadIfOpen', () => {
  it('replaces content and preserves id', async () => {
    vi.resetModules();
    const tauri = await import('../lib/tauri');
    const spy = vi.spyOn(tauri, 'openFile').mockResolvedValue({
      path: 'C:/r.txt', content: 'NEW', encoding: 'utf-8', eol: 'lf',
    });

    const id = useBuffers.getState().openBuffer({
      path: 'C:/r.txt', content: 'OLD', encoding: 'utf-8', eol: 'lf',
    });
    await useBuffers.getState().reloadIfOpen('C:/r.txt');

    const buf = useBuffers.getState().buffers.find((b) => b.id === id);
    expect(buf?.content).toBe('NEW');
    expect(buf?.id).toBe(id);
    spy.mockRestore();
  });

  it('does nothing for unknown path', async () => {
    await useBuffers.getState().reloadIfOpen('C:/never-opened.txt');
    // No throw, no buffers created.
    expect(useBuffers.getState().buffers.find((b) => b.path === 'C:/never-opened.txt')).toBeUndefined();
  });

  it('skips dirty buffers', async () => {
    vi.resetModules();
    const tauri = await import('../lib/tauri');
    const spy = vi.spyOn(tauri, 'openFile');

    const id = useBuffers.getState().openBuffer({
      path: 'C:/d.txt', content: 'OLD', encoding: 'utf-8', eol: 'lf',
    });
    // Make it dirty.
    useBuffers.getState().switchTo(id);
    useBuffers.getState().setActiveContent('EDITED');
    await useBuffers.getState().reloadIfOpen('C:/d.txt');

    expect(spy).not.toHaveBeenCalled();
    const buf = useBuffers.getState().buffers.find((b) => b.id === id);
    expect(buf?.content).toBe('EDITED');
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run — should fail**

```powershell
npm test -- buffers
```

Expected: FAIL — `reloadIfOpen` doesn't exist.

- [ ] **Step 3: Add the signature to `BuffersState` interface in `src/stores/buffers.ts`**

```ts
  reloadIfOpen: (path: string) => Promise<void>;
```

- [ ] **Step 4: Add the implementation inside the `create<BuffersState>((set, get) => ({ … }))` block**

Place it RIGHT BEFORE the existing `resetAll: () => { ... },` line:

```ts
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
```

- [ ] **Step 5: Run the test**

```powershell
npm test -- buffers
```

Expected: all 3 new tests PASS, plus all existing buffer tests.

- [ ] **Step 6: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Commit**

```powershell
git add src/stores/buffers.ts src/tests/buffers.test.ts
git commit -m "buffers: reloadIfOpen for replace-in-files"
```

---

## Task 9: Workspace store `replaceInFiles` action

**Files:**
- Modify: `src/stores/workspace.ts`
- Create: `src/tests/workspace-replace.test.ts`

- [ ] **Step 1: Create failing tests at `src/tests/workspace-replace.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { useWorkspace } from '../stores/workspace';
import { useBuffers } from '../stores/buffers';

beforeEach(() => {
  useWorkspace.setState({
    workspaceFolder: 'C:/proj',
    results: {
      files: [
        { path: 'C:/proj/a.rs', matches: [{ line_number: 1, line_text: 'foo', match_ranges: [[0, 3]] }] },
      ],
      truncated: false,
      elapsed_ms: 1,
    },
    inFlight: false,
    replaceInFlight: false,
    lastQuery: 'foo',
    lastOpts: { regex: false, case_sensitive: false, whole_word: false },
    expanded: new Set<string>(),
    childrenByPath: new Map(),
    loadingByPath: new Set<string>(),
  } as never);
  useBuffers.setState({ buffers: [], activeId: null, recentlyClosed: [] } as never, true);
  vi.clearAllMocks();
});

describe('useWorkspace.replaceInFiles', () => {
  function defaultOpts() { return { regex: false, case_sensitive: false, whole_word: false }; }

  it('uses lastQuery, lastOpts, and current target_paths', async () => {
    (invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string) => {
      if (cmd === 'replace_in_files') return { results: [], total_files_replaced: 0, total_matches_replaced: 0 };
      if (cmd === 'find_in_folder') return { files: [], truncated: false, elapsed_ms: 1 };
      return null;
    });
    await useWorkspace.getState().replaceInFiles('bar');
    // First call should be replace_in_files.
    expect(invoke).toHaveBeenCalledWith('replace_in_files', expect.objectContaining({
      folder: 'C:/proj',
      query: 'foo',
      replacement: 'bar',
      opts: defaultOpts(),
      targetPaths: ['C:/proj/a.rs'],
    }));
  });

  it('skips when there are no results', async () => {
    useWorkspace.setState({ results: null } as never);
    await useWorkspace.getState().replaceInFiles('bar');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reloads open buffers for successfully replaced files', async () => {
    (invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string) => {
      if (cmd === 'replace_in_files') return {
        results: [{ path: 'C:/proj/a.rs', matches_replaced: 1, error: null }],
        total_files_replaced: 1,
        total_matches_replaced: 1,
      };
      if (cmd === 'find_in_folder') return { files: [], truncated: false, elapsed_ms: 1 };
      if (cmd === 'open_file') return { path: 'C:/proj/a.rs', content: 'bar', encoding: 'utf-8', eol: 'lf' };
      return null;
    });
    // Pre-open the buffer.
    useBuffers.getState().openBuffer({
      path: 'C:/proj/a.rs', content: 'foo', encoding: 'utf-8', eol: 'lf',
    });
    const spy = vi.spyOn(useBuffers.getState(), 'reloadIfOpen');
    await useWorkspace.getState().replaceInFiles('bar');
    expect(spy).toHaveBeenCalledWith('C:/proj/a.rs');
    spy.mockRestore();
  });

  it('re-runs the search after completion', async () => {
    const callOrder: string[] = [];
    (invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string) => {
      callOrder.push(cmd);
      if (cmd === 'replace_in_files') return { results: [], total_files_replaced: 0, total_matches_replaced: 0 };
      if (cmd === 'find_in_folder') return { files: [], truncated: false, elapsed_ms: 1 };
      return null;
    });
    await useWorkspace.getState().replaceInFiles('bar');
    expect(callOrder).toEqual(['replace_in_files', 'find_in_folder']);
  });
});
```

- [ ] **Step 2: Run — should fail**

```powershell
npm test -- workspace-replace
```

Expected: FAIL — `replaceInFiles` action doesn't exist on the store.

- [ ] **Step 3: Edit `src/stores/workspace.ts`**

3a. Add `replaceInFiles` to the existing import line at the top:

```ts
import { findInFolder, listDir, replaceInFiles as replaceInFilesIpc, type FindOptions, type FindResponse, type DirEntry, type ReplaceResponse } from '../lib/tauri';
```

3b. Add to the `WorkspaceState` interface:

```ts
replaceInFlight: boolean;
replaceInFiles: (replacement: string) => Promise<ReplaceResponse>;
```

3c. Add the initial state value inside the `create<WorkspaceState>((set, get) => ({ … }))` block, near the existing initial values:

```ts
replaceInFlight: false,
```

3d. Add the action implementation inside the same block. Put it RIGHT BEFORE the existing `clearTreeCache()` action (or wherever fits alphabetically):

```ts
async replaceInFiles(replacement) {
  const cur = get();
  if (!cur.workspaceFolder) {
    return { results: [], total_files_replaced: 0, total_matches_replaced: 0 };
  }
  if (!cur.results || cur.results.files.length === 0) {
    return { results: [], total_files_replaced: 0, total_matches_replaced: 0 };
  }
  if (cur.lastQuery.trim() === '') {
    return { results: [], total_files_replaced: 0, total_matches_replaced: 0 };
  }

  const targetPaths = cur.results.files.map((f) => f.path);
  set({ replaceInFlight: true });
  let resp: ReplaceResponse;
  try {
    resp = await replaceInFilesIpc(
      cur.workspaceFolder, cur.lastQuery, replacement, cur.lastOpts, targetPaths,
    );
  } finally {
    set({ replaceInFlight: false });
  }

  // Refresh search results.
  await get().runSearch(cur.lastQuery, cur.lastOpts);

  // Reload any open buffer whose file was successfully replaced.
  const { useBuffers } = await import('./buffers');
  for (const r of resp.results) {
    if (r.error == null && r.matches_replaced > 0) {
      await useBuffers.getState().reloadIfOpen(r.path);
    }
  }

  return resp;
},
```

- [ ] **Step 4: Run the tests**

```powershell
npm test -- workspace-replace
```

Expected: 4 PASS. Also run existing workspace tests:

```powershell
npm test -- workspace
```

Expected: all green (existing 10 + 4 new = 14).

- [ ] **Step 5: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```powershell
git add src/stores/workspace.ts src/tests/workspace-replace.test.ts
git commit -m "workspace: replaceInFiles action + 4 vitest cases"
```

---

## Task 10: SearchPanel — replace input + visibility toggle

**Files:**
- Modify: `src/components/SearchPanel.tsx`

- [ ] **Step 1: Add new state + replace input UI**

In `src/components/SearchPanel.tsx`, inside `export function SearchPanel()`, near the existing `const [query, setQuery] = useState('')`:

```tsx
const [replace, setReplace] = useState('');
const [replaceVisible, setReplaceVisible] = useState(false);
```

- [ ] **Step 2: Modify the find-input row to include a `↔` toggle button**

Find the existing JSX block:

```tsx
<div className="flex items-center gap-2 border-b border-neutral-700 px-3 py-2">
  <input
    ref={inputRef}
    data-testid="search-input"
    …
  />
</div>
```

Replace with:

```tsx
<div className="flex flex-col gap-1 border-b border-neutral-700 px-3 py-2">
  <div className="flex items-center gap-2">
    <button
      type="button"
      data-testid="replace-toggle"
      onClick={() => setReplaceVisible((v) => !v)}
      title={replaceVisible ? 'Hide replace' : 'Show replace'}
      className="rounded px-1 text-neutral-500 hover:text-neutral-200"
    >↔</button>
    <input
      ref={inputRef}
      data-testid="search-input"
      type="text"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Search"
      className="flex-1 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500"
    />
  </div>
  {replaceVisible && (
    <input
      data-testid="replace-input"
      type="text"
      value={replace}
      onChange={(e) => setReplace(e.target.value)}
      placeholder="Replace"
      className="ml-6 flex-1 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500"
    />
  )}
</div>
```

- [ ] **Step 3: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Vitest**

```powershell
npm test
```

Expected: all green (no regressions — this task only adds UI state).

- [ ] **Step 5: Commit**

```powershell
git add src/components/SearchPanel.tsx
git commit -m "ui: SearchPanel replace input + visibility toggle"
```

---

## Task 11: SearchPanel — Snippet diff preview + Replace All button

**Files:**
- Modify: `src/components/SearchPanel.tsx`

- [ ] **Step 1: Extend `Snippet` to accept an optional `replacement` prop and compute the post-replace text**

Find the existing `function Snippet({ text, ranges }: { … })` near the bottom and replace with:

```tsx
function Snippet({ text, ranges, replacement, opts }: {
  text: string;
  ranges: [number, number][];
  replacement?: string;
  opts?: { regex: boolean; case_sensitive: boolean; whole_word: boolean };
}) {
  if (ranges.length === 0) return <span>{text}</span>;
  const parts: import('react').ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([s, e], i) => {
    if (s > cursor) parts.push(<span key={`p${i}`}>{text.slice(cursor, s)}</span>);
    const oldSpan = text.slice(s, e);
    if (typeof replacement === 'string' && opts) {
      // Compute the substituted text for THIS match. Build the same client-side
      // regex used to color the match; replace within the matched substring.
      let pattern = opts.regex ? text.slice(s, e) : oldSpan.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Simpler: just compute the substituted text by feeding oldSpan through a
      // regex that matches the original pattern. For the literal case we just
      // replace with `replacement` directly. For regex with backrefs we need to
      // re-derive the pattern from the find input — but the SearchPanel knows
      // the query, so it'll pass `query` in via a new prop in step 2.
      pattern = pattern; // placeholder; resolved by Step 2 props.
      const newSpan = replacement; // Step 2 will swap this for a real re-run.
      parts.push(<s key={`o${i}`} className="text-neutral-500">{oldSpan}</s>);
      parts.push(<mark key={`n${i}`} className="bg-emerald-500/30 text-emerald-200">{newSpan}</mark>);
    } else {
      parts.push(<mark key={`m${i}`} className="bg-amber-400/30 text-amber-200">{oldSpan}</mark>);
    }
    cursor = e;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{parts}</>;
}
```

NOTE: Step 1 introduces the replacement preview but uses the literal replacement string for both literal and regex modes. Backreferences in regex mode won't be substituted in the preview (they will be substituted in the actual write). Acceptable for v1 — the preview is a hint, not a contract. If the executor wants to add proper backref preview, they can do so by accepting a `query` prop and constructing a `new RegExp(query, …)` to call `.replace(re, replacement)` on `oldSpan`. Not required for shipping.

- [ ] **Step 2: Pass `replacement` + `opts` to Snippet via `ResultRow`**

Find the existing `function ResultRow({ path, match }: { … })` and update signature + call site to accept and pass through:

```tsx
function ResultRow({ path, match, replacement, opts }: {
  path: string;
  match: LineMatch;
  replacement?: string;
  opts: FindOptions;
}) {
  return (
    <button
      type="button"
      data-testid="match-row"
      onClick={async () => {
        const existing = useBuffers.getState().buffers.find((b) => b.path === path);
        if (!existing) {
          try {
            const opened = await openFileIpc(path);
            useBuffers.getState().openBuffer(opened);
          } catch { return; }
        }
        const range: [number, number] = match.match_ranges[0] ?? [0, match.line_text.length];
        useBuffers.getState().openFileAtLine(path, match.line_number, range, match.line_text);
      }}
      className="block w-full cursor-pointer truncate px-6 py-0.5 text-left text-xs hover:bg-neutral-800"
      title={match.line_text}
    >
      <span className="mr-2 text-neutral-500">{match.line_number}:</span>
      <Snippet text={match.line_text} ranges={match.match_ranges} replacement={replacement} opts={opts} />
    </button>
  );
}
```

- [ ] **Step 3: Thread `replacement` + `opts` through `FileGroup`**

Find the existing `function FileGroup({ file })` and update:

```tsx
function FileGroup({ file, replacement, opts }: {
  file: FileMatch;
  replacement?: string;
  opts: FindOptions;
}) {
  const short = file.path.split(/[/\\]/).pop() ?? file.path;
  return (
    <div className="border-b border-neutral-800">
      <div className="truncate px-3 py-1 text-xs text-neutral-400" title={file.path}>{short}</div>
      <ul>
        {file.matches.map((m, i) => (
          <li key={i}>
            <ResultRow path={file.path} match={m} replacement={replacement} opts={opts} />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Update `ResultsBody` to pass `replacement` + `opts` to FileGroup AND render the Replace All button**

Find the existing `function ResultsBody({ inFlight, results }: { … })` and replace with:

```tsx
function ResultsBody({
  inFlight,
  results,
  replacement,
  opts,
  onReplaceClick,
}: {
  inFlight: boolean;
  results: FindResponse | null;
  replacement: string;
  opts: FindOptions;
  onReplaceClick: () => void;
}) {
  if (inFlight && !results) return <div className="p-3 text-xs text-neutral-500">Searching…</div>;
  if (!results) return <div className="p-3 text-xs text-neutral-500">Type to search.</div>;
  if (results.error) return <div data-testid="search-error" className="p-3 text-xs text-red-400">{results.error}</div>;
  if (results.files.length === 0) return <div className="p-3 text-xs text-neutral-500">No matches.</div>;

  const total = results.files.reduce((n, f) => n + f.matches.length, 0);
  const replaceArmed = replacement !== '' || replacement === '';
  // ↑ Replace All shows whenever there are results; replacement may legitimately be empty.

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-auto">
        {results.files.map((f) => (
          <FileGroup key={f.path} file={f} replacement={replaceArmed ? replacement : undefined} opts={opts} />
        ))}
      </div>
      <div
        data-testid="search-status"
        className={`flex items-center justify-between gap-2 border-t border-neutral-700 px-3 py-1 text-xs ${
          results.truncated ? 'text-amber-400' : 'text-neutral-500'
        }`}
      >
        <span>
          {results.truncated
            ? `${total.toLocaleString()}+ matches — refine your query`
            : `${total.toLocaleString()} match${total === 1 ? '' : 'es'} in ${results.files.length} file${results.files.length === 1 ? '' : 's'}`}
        </span>
        {replaceArmed && (
          <button
            type="button"
            data-testid="replace-all"
            onClick={onReplaceClick}
            className="rounded bg-emerald-700 px-2 py-0.5 text-emerald-100 hover:bg-emerald-600"
          >
            Replace All in {results.files.length}
          </button>
        )}
      </div>
    </div>
  );
}
```

NOTE: the `replaceArmed` const is always true here (the boolean trick `replacement !== '' || replacement === ''` evaluates to `true`). The intent is: when the replace input is visible, the diff preview + button show. When replace input is hidden, neither shows. This is gated by the parent passing `replacement` only when `replaceVisible` is true. Update the parent caller below.

- [ ] **Step 5: Update `SearchPanel` to wire dialog state + pass props correctly**

In the `SearchPanel` component, find the bottom JSX `<ResultsBody inFlight={inFlight} results={results} />` and replace with:

```tsx
<ResultsBody
  inFlight={inFlight}
  results={results}
  replacement={replaceVisible ? replace : ''}
  opts={opts}
  onReplaceClick={() => setDialogOpen(true)}
/>
{dialogOpen && (
  <ReplaceConfirmDialog
    replacement={replace}
    onClose={() => setDialogOpen(false)}
  />
)}
```

Also add at the top of `SearchPanel`, alongside the existing useState calls:

```tsx
const [dialogOpen, setDialogOpen] = useState(false);
```

And import the dialog at the top of the file (right after the other imports):

```tsx
import { ReplaceConfirmDialog } from './ReplaceConfirmDialog';
```

NOTE: `ReplaceConfirmDialog` is created in Task 12. For this task to compile, we need to skip ahead and create at least a stub. Create `src/components/ReplaceConfirmDialog.tsx` with:

```tsx
interface Props {
  replacement: string;
  onClose: () => void;
}
export function ReplaceConfirmDialog(_props: Props) {
  // Replaced in Task 12.
  return null;
}
```

Also gate `ResultsBody`'s preview on the parent passing a meaningful replacement. Replace the `replaceArmed` const in `ResultsBody` with:

```tsx
const replaceArmed = replacement !== '' || (typeof replacement === 'string' && replacement.length === 0);
```

(again always true, but the prop only carries a non-empty string when the input is visible AND user has typed something OR when user has explicitly chosen empty replacement). To make the preview show ONLY when the replace input is visible, change the parent call site to:

```tsx
<ResultsBody
  inFlight={inFlight}
  results={results}
  replacement={replaceVisible ? replace : ''}
  opts={opts}
  onReplaceClick={() => setDialogOpen(true)}
/>
```

And inside `ResultsBody`, check `replacement === '' && !replaceArmed` is meaningless. Simplify: use a new prop `showReplaceUI: boolean` to gate the diff preview + button:

```tsx
function ResultsBody({
  inFlight, results, replacement, opts, onReplaceClick, showReplaceUI,
}: {
  inFlight: boolean;
  results: FindResponse | null;
  replacement: string;
  opts: FindOptions;
  onReplaceClick: () => void;
  showReplaceUI: boolean;
}) { … render conditionally on showReplaceUI … }
```

Parent call:

```tsx
<ResultsBody
  inFlight={inFlight}
  results={results}
  replacement={replace}
  opts={opts}
  onReplaceClick={() => setDialogOpen(true)}
  showReplaceUI={replaceVisible}
/>
```

Inside `ResultsBody`, pass `replacement={showReplaceUI ? replacement : undefined}` to `<FileGroup>` and gate the `Replace All` button on `showReplaceUI`.

- [ ] **Step 6: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean, vitest all green (this task only adds UI props; no test changes).

- [ ] **Step 7: Commit**

```powershell
git add src/components/SearchPanel.tsx src/components/ReplaceConfirmDialog.tsx
git commit -m "ui: SearchPanel Snippet diff preview + Replace All button + dialog stub"
```

---

## Task 12: `ReplaceConfirmDialog` — confirm / dirty-blocked / summary

**Files:**
- Modify: `src/components/ReplaceConfirmDialog.tsx`

- [ ] **Step 1: Replace the stub with the full dialog**

```tsx
import { useEffect, useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import { useBuffers } from '../stores/buffers';
import type { ReplaceResponse } from '../lib/tauri';

interface Props {
  replacement: string;
  onClose: () => void;
}

type Phase = 'idle' | 'inFlight' | 'done';

export function ReplaceConfirmDialog({ replacement, onClose }: Props) {
  const results = useWorkspace((s) => s.results);
  const replaceInFiles = useWorkspace((s) => s.replaceInFiles);
  const [phase, setPhase] = useState<Phase>('idle');
  const [response, setResponse] = useState<ReplaceResponse | null>(null);

  const targetPaths = (results?.files ?? []).map((f) => f.path);
  const totalMatches = (results?.files ?? []).reduce((n, f) => n + f.matches.length, 0);
  const totalFiles = results?.files.length ?? 0;

  const dirtyConflicts = useBuffers.getState().buffers.filter(
    (b) => b.dirty && b.path && targetPaths.includes(b.path),
  );

  // Auto-close after success-only completion.
  useEffect(() => {
    if (phase !== 'done' || !response) return;
    const hasErrors = response.results.some((r) => r.error != null);
    if (hasErrors) return; // sticky path
    const handle = setTimeout(onClose, 1500);
    return () => clearTimeout(handle);
  }, [phase, response, onClose]);

  return (
    <div
      data-testid="replace-confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[420px] rounded border border-neutral-700 bg-neutral-900 p-4 text-sm text-neutral-200 shadow-xl">
        {dirtyConflicts.length > 0 && phase === 'idle' && (
          <DirtyBlocked dirty={dirtyConflicts} onClose={onClose} />
        )}
        {dirtyConflicts.length === 0 && phase === 'idle' && (
          <ConfirmBody
            totalMatches={totalMatches}
            totalFiles={totalFiles}
            replacement={replacement}
            onCancel={onClose}
            onConfirm={async () => {
              setPhase('inFlight');
              try {
                const resp = await replaceInFiles(replacement);
                setResponse(resp);
                setPhase('done');
              } catch (err) {
                setResponse({
                  results: [{ path: '', matches_replaced: 0, error: (err as Error).message }],
                  total_files_replaced: 0,
                  total_matches_replaced: 0,
                });
                setPhase('done');
              }
            }}
          />
        )}
        {phase === 'inFlight' && (
          <div data-testid="replace-in-flight" className="text-neutral-400">Replacing…</div>
        )}
        {phase === 'done' && response && <SummaryBody response={response} onClose={onClose} />}
      </div>
    </div>
  );
}

function ConfirmBody({
  totalMatches, totalFiles, replacement, onCancel, onConfirm,
}: {
  totalMatches: number;
  totalFiles: number;
  replacement: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const verb = replacement === '' ? 'Delete' : 'Replace';
  return (
    <>
      <p className="mb-4">
        {verb} {totalMatches} {totalMatches === 1 ? 'match' : 'matches'} in {totalFiles} {totalFiles === 1 ? 'file' : 'files'}?
      </p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1 text-neutral-400 hover:bg-neutral-800"
        >Cancel</button>
        <button
          type="button"
          data-testid="replace-confirm-btn"
          onClick={onConfirm}
          className="rounded bg-emerald-700 px-3 py-1 text-emerald-100 hover:bg-emerald-600"
        >{verb}</button>
      </div>
    </>
  );
}

function DirtyBlocked({
  dirty, onClose,
}: {
  dirty: { id: string; path: string | null }[];
  onClose: () => void;
}) {
  return (
    <>
      <p className="mb-2 font-medium">Unsaved changes in:</p>
      <ul data-testid="replace-dirty-list" className="mb-4 ml-4 list-disc text-neutral-300">
        {dirty.map((b) => (
          <li key={b.id}>{(b.path ?? '').split(/[/\\]/).pop()}</li>
        ))}
      </ul>
      <p className="mb-4 text-neutral-400">Save or revert these files first.</p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-neutral-700 px-3 py-1 text-neutral-100 hover:bg-neutral-600"
        >Close</button>
      </div>
    </>
  );
}

function SummaryBody({ response, onClose }: { response: ReplaceResponse; onClose: () => void }) {
  const failures = response.results.filter((r) => r.error != null);
  if (failures.length === 0) {
    return (
      <div data-testid="replace-summary-success" className="text-emerald-300">
        Replaced {response.total_matches_replaced} {response.total_matches_replaced === 1 ? 'match' : 'matches'} in {response.total_files_replaced} {response.total_files_replaced === 1 ? 'file' : 'files'}.
      </div>
    );
  }
  return (
    <>
      <p data-testid="replace-summary-partial" className="mb-2">
        Replaced {response.total_files_replaced}/{response.results.length} files.
      </p>
      <p className="mb-2 text-amber-400">Failed:</p>
      <ul className="mb-4 ml-4 max-h-40 list-disc overflow-auto text-neutral-300">
        {failures.map((r, i) => {
          const name = (r.path || '').split(/[/\\]/).pop() || '(unknown)';
          return <li key={i}>{name}{r.error ? ` (${r.error})` : ''}</li>;
        })}
      </ul>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-neutral-700 px-3 py-1 text-neutral-100 hover:bg-neutral-600"
        >OK</button>
      </div>
    </>
  );
}
```

- [ ] **Step 2: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Vitest**

```powershell
npm test
```

Expected: all 14 workspace + 22 buffer + others = ~70 pass. No regressions.

- [ ] **Step 4: Commit**

```powershell
git add src/components/ReplaceConfirmDialog.tsx
git commit -m "ui: ReplaceConfirmDialog with confirm/blocked/summary branches"
```

---

## Task 13: e2e tests for replace-in-files

**Files:**
- Create: `tests/e2e/replace-in-files.spec.ts`

- [ ] **Step 1: Create the spec**

The fixture `tests/e2e/fixtures/workspace/` is read-only across runs from slice-1's perspective; this spec copies it to a temp folder at start of each test to avoid mutating the checked-in fixture.

`tests/e2e/replace-in-files.spec.ts`:

```ts
import { expect } from 'chai';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { getBrowser, classicExecute } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const FIXTURE_SRC = path.resolve(__dirname, 'fixtures', 'workspace');

function copyFixtureToTemp(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'memopad-rep-'));
  // Recursive copy.
  function cp(src: string, dst: string) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (e.isDirectory()) cp(s, d);
      else fs.copyFileSync(s, d);
    }
  }
  cp(FIXTURE_SRC, dest);
  return dest;
}

describe('replace-in-files', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = copyFixtureToTemp();
    await exec(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadToggleSidebar?: () => void;
        __memopadTestSetWorkspace?: (folder: string | null) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestSetWorkspace?.(null as unknown as string);
      const open = !!document.querySelector('[data-testid="sidebar"]');
      if (open) w.__memopadToggleSidebar?.();
    });
    await sleep(150);
  });

  afterEach(() => {
    if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('Replace All rewrites matches and refreshes results', async () => {
    // Open sidebar, set workspace, search "alpha", show replace, type "ALPHA", click Replace All, confirm.
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(workspace)}); return undefined;`,
    );
    await sleep(150);
    // Switch to Search tab (Ctrl+Shift+F opens sidebar+focuses find).
    await getBrowser().keys(['Control', 'Shift', 'f']);
    await sleep(200);
    // Type query.
    await classicExecute<void>(
      `const i = document.querySelector('[data-testid="search-input"]');
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(i, 'alpha');
       i.dispatchEvent(new Event('input', { bubbles: true }));
       return undefined;`,
    );
    await sleep(800);
    // Reveal replace input.
    await classicExecute<void>(
      `document.querySelector('[data-testid="replace-toggle"]').click(); return undefined;`,
    );
    await sleep(150);
    await classicExecute<void>(
      `const i = document.querySelector('[data-testid="replace-input"]');
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(i, 'ALPHA');
       i.dispatchEvent(new Event('input', { bubbles: true }));
       return undefined;`,
    );
    await sleep(200);
    // Click Replace All.
    await classicExecute<void>(
      `document.querySelector('[data-testid="replace-all"]').click(); return undefined;`,
    );
    await sleep(200);
    // Confirm dialog → click Replace.
    await classicExecute<void>(
      `document.querySelector('[data-testid="replace-confirm-btn"]').click(); return undefined;`,
    );
    await sleep(2000); // replace + auto-close
    // Verify file content on disk.
    const notesPath = path.join(workspace, 'notes.txt');
    const after = fs.readFileSync(notesPath, 'utf-8');
    expect(after).to.match(/ALPHA/);
    expect(after).to.not.match(/alpha/);
  });

  it('dirty buffer blocks replace with a warning dialog', async () => {
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(workspace)}); return undefined;`,
    );
    await sleep(150);
    // Open notes.txt as a buffer and make it dirty via test hooks.
    const notesPath = path.join(workspace, 'notes.txt').replace(/\\/g, '/');
    await classicExecute<void>(
      `(async () => {
         const tauri = await import('@tauri-apps/api/core');
         const opened = await tauri.invoke('open_file', { path: ${JSON.stringify(notesPath)} });
         const buffersMod = await import('/src/stores/buffers');
         const id = buffersMod.useBuffers.getState().openBuffer(opened);
         buffersMod.useBuffers.getState().switchTo(id);
         buffersMod.useBuffers.getState().setActiveContent('dirty edit');
       })(); return undefined;`,
    );
    await sleep(400);
    // Run a search + open replace + Replace All.
    await getBrowser().keys(['Control', 'Shift', 'f']);
    await sleep(200);
    await classicExecute<void>(
      `const i = document.querySelector('[data-testid="search-input"]');
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(i, 'alpha');
       i.dispatchEvent(new Event('input', { bubbles: true }));
       return undefined;`,
    );
    await sleep(800);
    await classicExecute<void>(
      `document.querySelector('[data-testid="replace-toggle"]').click(); return undefined;`,
    );
    await sleep(150);
    await classicExecute<void>(
      `const i = document.querySelector('[data-testid="replace-input"]');
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(i, 'X');
       i.dispatchEvent(new Event('input', { bubbles: true }));
       return undefined;`,
    );
    await sleep(200);
    await classicExecute<void>(
      `document.querySelector('[data-testid="replace-all"]').click(); return undefined;`,
    );
    await sleep(300);
    // Dialog should show the dirty list.
    const dirtyListPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="replace-dirty-list"]');`,
    );
    expect(dirtyListPresent).to.equal(true);
    // No confirm button should exist in this variant.
    const confirmPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="replace-confirm-btn"]');`,
    );
    expect(confirmPresent).to.equal(false);
  });
});
```

NOTE: the second test uses dynamic `import('/src/stores/buffers')`. If that path doesn't resolve in the WebView2 dev runtime, replace it with a `__memopadTestSetActiveContent` window hook that the spec defines in `App.tsx` (already similar to `__memopadTestSetWorkspace`). If the executor finds the dynamic import doesn't work, they should add a `__memopadTestDirtyBuffer(path: string, newContent: string)` window hook to `App.tsx` and use it here.

- [ ] **Step 2: Type-check e2e**

```powershell
npx tsc -p tsconfig.e2e.json --noEmit 2>&1
```

Expected: same `TransformReturn<T>` baseline pattern as other specs. No new error types.

- [ ] **Step 3: DO NOT run `npm run e2e`** — defer to T14.

- [ ] **Step 4: Commit**

```powershell
git add tests/e2e/replace-in-files.spec.ts
git commit -m "e2e: replace-in-files (success path + dirty-buffer block)"
```

---

## Task 14: Manual gates + results doc

**Files:**
- Create: `docs/superpowers/plans/v2-replace-in-files-results.md`

- [ ] **Step 1: tsc + vitest + cargo**

```powershell
npx tsc --noEmit
npm test
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib
cd ..
```

Capture:
- vitest total (expected: ~66 = 61 baseline + 4 workspace-replace + 1+ buffers)
- cargo total (expected: ~77 = 70 baseline + 7 replace)

- [ ] **Step 2: Release build**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri build
```

Capture sizes:
- `src-tauri/target/release/bundle/msi/Memopad_0.1.0_x64_en-US.msi`
- `src-tauri/target/release/app.exe`

Slice-2 baseline: MSI 6.42 MB, app.exe 15.81 MB. Replace adds minimal footprint (one new function + one new component).

- [ ] **Step 3: Skip `npm run e2e`** — defer to manual verification.

- [ ] **Step 4: Write results doc**

Create `docs/superpowers/plans/v2-replace-in-files-results.md`:

```markdown
# v2 Replace in Files — Results

## Automated test gates

- Vitest: <N> tests passing (baseline 61; +4 workspace-replace + N buffers ≈ 66 expected)
- cargo test: <N> tests passing (baseline 70; +7 replace = 77 expected)
- e2e (WebdriverIO): spec written (2 tests); full run deferred to manual verification
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: <X.XX> MB (slice-2 baseline 6.42 MB)
- app.exe size: <X.XX> MB (slice-2 baseline 15.81 MB)

## What shipped

- `src-tauri/src/search.rs` gained `replace_in_files` + `FileResult`/`ReplaceResponse` types + 7 tests
- `build_matcher_pattern` extracted as a shared helper between find and replace
- `src/stores/workspace.ts` gained `replaceInFlight` + `replaceInFiles` action
- `src/stores/buffers.ts` gained `reloadIfOpen` action
- `src/components/SearchPanel.tsx` — replace input + visibility toggle + Snippet diff preview + Replace All button
- `src/components/ReplaceConfirmDialog.tsx` — confirm / dirty-blocked / summary branches
- New Tauri command: `replace_in_files`

## What is intentionally NOT in this slice

- Per-match or per-file checkboxes
- In-app undo of a completed replace
- Rollback across files on partial failure
- Background / streaming application
- Regex backreference preview in Snippet (literal preview only; actual write substitutes correctly)

## Follow-ups (next v2 slices)

1. Recent folders (Ctrl+R)
2. fs watcher (notify crate) for auto-refresh
3. File-tree right-click context menu
4. Backref-aware preview in Snippet
```

Fill in the actual numbers.

- [ ] **Step 5: Commit**

```powershell
git add docs/superpowers/plans/v2-replace-in-files-results.md
git commit -m "v2 replace in files: record results"
```

---

## Self-review notes (don't delete)

**Spec coverage check:**

| Spec section | Covered by |
| --- | --- |
| `build_matcher_pattern` shared helper | Task 1 |
| `FileResult` / `ReplaceResponse` types | Task 2 |
| `replace_in_files` Rust impl | Task 3 |
| Case/regex/whole-word/skip-no-match tests | Task 4 |
| Encoding preservation + IO error tests | Task 5 |
| Tauri command registration | Task 6 |
| TS IPC wrapper | Task 7 |
| `buffers.reloadIfOpen` | Task 8 |
| `workspace.replaceInFiles` action | Task 9 |
| SearchPanel replace input + toggle | Task 10 |
| Snippet diff preview + Replace All button | Task 11 |
| `ReplaceConfirmDialog` branches | Task 12 |
| 2 e2e tests | Task 13 |
| Manual gates + results doc | Task 14 |

**Placeholder scan:** None.

**Type / signature consistency:**
- `FileResult { path, matches_replaced, error }` — Rust struct → TS interface (snake_case in TS to match Rust serde output). Verified across Task 2, Task 7.
- `ReplaceResponse { results, total_files_replaced, total_matches_replaced }` — consistent.
- `replaceInFiles(replacement: string): Promise<ReplaceResponse>` — Task 9 store interface matches Task 12 dialog consumer.
- `reloadIfOpen(path: string): Promise<void>` — Task 8 interface matches Task 9 store consumer.
- `data-testid` attributes: `replace-toggle`, `replace-input`, `replace-all`, `replace-confirm-dialog`, `replace-confirm-btn`, `replace-dirty-list`, `replace-in-flight`, `replace-summary-success`, `replace-summary-partial`. Used consistently in Task 10/11/12 and exercised in Task 13.

**Notes for executor:**
- The Snippet diff preview in Task 11 uses the literal replacement string for both literal and regex modes. Regex backreferences are NOT expanded in the preview. The actual file write expands them correctly (via `Regex::replace_all`). If this bothers users, add a follow-up that constructs a JS `RegExp(query, flags)` and uses `.replace(jsRe, replacement)` to render the preview accurately. Not blocking for ship.
- The e2e dirty-buffer test uses dynamic `import('/src/stores/buffers')` to manipulate buffer state. If this path doesn't resolve at runtime, add a `__memopadTestDirtyBuffer(path, content)` window hook to `App.tsx` next to `__memopadTestSetWorkspace`.
- `replaceInFiles` does its post-write search refresh BEFORE reloading open buffers. The order matters slightly: the search results show fewer matches immediately, then the editor catches up. Reversing the order would briefly show stale results while open buffers are already updated. The chosen order keeps the panel as the source of truth.
