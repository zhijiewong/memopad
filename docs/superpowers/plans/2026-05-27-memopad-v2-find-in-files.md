# Memopad v2 — Find in Files

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-wide search to Memopad. The user opens a folder once (`Ctrl+K Ctrl+O`), then `Ctrl+Shift+F` reveals a left sidebar Search panel that finds every match across that folder via a ripgrep-powered Rust command, jumping into the editor at the matched line on click.

**Architecture:** A new `src-tauri/src/search.rs` module owns the ripgrep-driven walk and exposes one Tauri command `find_in_folder`. A new `src/stores/workspace.ts` Zustand slice holds the workspace folder + search state and runs queries through the IPC bridge with frontend-only stale-drop cancellation. Two new components (`Sidebar.tsx`, `SearchPanel.tsx`) host the UI; `TitleBar.tsx` and `App.tsx` get the toggle + keybindings. The existing `session::SessionState` gains a backward-compatible `workspace_folder` field so the chosen folder survives relaunch.

**Tech Stack:** Tauri 2, Rust (`grep`, `grep-regex`, `grep-searcher`, `ignore`, plus existing `serde`/`serde_json`), React + Zustand + Tailwind + CodeMirror 6. No frontend dependency adds.

**Spec section reference:** `docs/superpowers/specs/2026-05-27-find-in-files-design.md` (all sections).

---

## File Structure

```
memopad/
├── src-tauri/
│   ├── Cargo.toml                  MODIFY — add grep/grep-regex/grep-searcher/ignore
│   ├── src/
│   │   ├── lib.rs                  MODIFY — register search command, mod search
│   │   ├── search.rs               CREATE — types + find_in_folder + tests
│   │   └── session.rs              MODIFY — add workspace_folder field
├── src/
│   ├── lib/
│   │   ├── tauri.ts                MODIFY — add findInFolder IPC wrapper + types
│   │   └── boot.ts                 MODIFY — rehydrate workspaceFolder
│   ├── stores/
│   │   ├── workspace.ts            CREATE — Zustand slice
│   │   └── buffers.ts              MODIFY — add openFileAtLine action
│   ├── components/
│   │   ├── Sidebar.tsx             CREATE — collapsible left column
│   │   ├── SearchPanel.tsx         CREATE — input + toggles + results
│   │   └── TitleBar.tsx            MODIFY — add sidebar toggle button
│   ├── commands/
│   │   └── builtins.ts             MODIFY — register workspace + view commands
│   ├── App.tsx                     MODIFY — mount Sidebar, wire shortcuts
│   └── tests/
│       ├── workspace.test.ts       CREATE
│       └── buffers.test.ts         MODIFY — openFileAtLine cases
└── tests/e2e/
    ├── fixtures/workspace/         CREATE — small text fixtures
    └── find-in-files.spec.ts       CREATE
```

Boundary intent:

- **`search.rs`** owns the ripgrep-driven walk and match collection. Pure function `find_in_folder` takes paths and `FindOptions`; the Tauri command wrapper lives in `lib.rs`. Tests use a tempdir.
- **`workspace.ts`** owns the workspace folder + search results in memory. Persistence is delegated to the existing session-save plumbing.
- **`Sidebar.tsx`** owns layout + collapse state. **`SearchPanel.tsx`** owns the search UI; it's the only component allowed to call `useWorkspace`.
- **`buffers.ts` `openFileAtLine`** is the single seam between the search results and the editor.

---

## Task 1: Add ripgrep crates to Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the three grep crates + `ignore`**

In `src-tauri/Cargo.toml`, the existing `[dependencies]` block ends with `tauri-plugin-updater = "2"`. Append four lines so the block becomes:

```toml
[dependencies]
serde_json = "1.0"
serde = { version = "1.0", features = ["derive"] }
log = "0.4"
tauri = { version = "2.11.2", features = [] }
tauri-plugin-log = "2"
encoding_rs = "0.8"
tauri-plugin-dialog = "2"
tauri-plugin-opener = "2"
tauri-plugin-updater = "2"
grep = "0.3"
grep-regex = "0.1"
grep-searcher = "0.1"
ignore = "0.4"
```

- [ ] **Step 2: Verify it resolves and compiles**

Run in PowerShell (prepend cargo to PATH first):

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo check
cd ..
```

Expected: "Finished `dev` profile" with no errors. The new crates download and the existing app still compiles.

- [ ] **Step 3: Commit**

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "deps(rust): add grep + ignore crates for find-in-files"
```

---

## Task 2: `search.rs` scaffold + types + `mod search;`

**Files:**
- Create: `src-tauri/src/search.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod search;`)

- [ ] **Step 1: Create `src-tauri/src/search.rs`**

EXACT contents:

```rust
// Project-wide search across a workspace folder.
// Powered by the ripgrep crate family (grep + grep-regex + grep-searcher + ignore).
// Pure function `find_in_folder` walks the folder, runs the matcher against every
// non-binary file, and returns the results (capped at MAX_MATCHES).

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Hard cap on total matches returned. Once reached the walk aborts and
/// `FindResponse.truncated` is set.
pub const MAX_MATCHES: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct FindOptions {
    pub regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LineMatch {
    pub line_number: u32,
    pub line_text: String,
    /// Byte offsets within `line_text`.
    pub match_ranges: Vec<(u32, u32)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileMatch {
    pub path: String,
    pub matches: Vec<LineMatch>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FindResponse {
    pub files: Vec<FileMatch>,
    pub truncated: bool,
    pub elapsed_ms: u64,
}

#[derive(Debug)]
pub enum FindError {
    InvalidRegex(String),
    WorkspaceMissing,
    Io(std::io::Error),
}

impl std::fmt::Display for FindError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FindError::InvalidRegex(msg) => write!(f, "Invalid regex: {}", msg),
            FindError::WorkspaceMissing => write!(f, "Folder no longer accessible"),
            FindError::Io(e) => write!(f, "{}", e),
        }
    }
}

impl From<std::io::Error> for FindError {
    fn from(e: std::io::Error) -> Self { FindError::Io(e) }
}

pub fn find_in_folder(
    _folder: &Path,
    _query: &str,
    _opts: &FindOptions,
) -> Result<FindResponse, FindError> {
    // Filled in by later tasks.
    Ok(FindResponse { files: Vec::new(), truncated: false, elapsed_ms: 0 })
}
```

- [ ] **Step 2: Declare `mod search;` in `src-tauri/src/lib.rs`**

In `src-tauri/src/lib.rs`, change the top:

```rust
mod fs;
mod journal;
mod session;
mod stat;
```

to:

```rust
mod fs;
mod journal;
mod search;
mod session;
mod stat;
```

(No other changes in lib.rs for this task — Task 8 wires the command.)

- [ ] **Step 3: Verify it compiles**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo check
cd ..
```

Expected: clean compile. The unused `find_in_folder` function may warn about unused parameters — that's fine for this task.

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/search.rs src-tauri/src/lib.rs
git commit -m "search: scaffold module + types"
```

---

## Task 3: `find_in_folder` — literal match in a single file

**Files:**
- Modify: `src-tauri/src/search.rs`

- [ ] **Step 1: Append the first test**

At the bottom of `src-tauri/src/search.rs` add:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "memopad_search_{}_{}_{}",
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
            std::process::id(),
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(dir: &std::path::Path, rel: &str, content: &str) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).unwrap(); }
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn finds_literal_match_in_single_file() {
        let dir = tmp("literal");
        write(&dir, "a.txt", "alpha\nbeta\nalpha gamma\n");

        let resp = find_in_folder(&dir, "alpha", &FindOptions::default()).unwrap();

        assert_eq!(resp.files.len(), 1);
        let f = &resp.files[0];
        assert!(f.path.ends_with("a.txt"));
        assert_eq!(f.matches.len(), 2);
        assert_eq!(f.matches[0].line_number, 1);
        assert_eq!(f.matches[0].line_text, "alpha");
        assert_eq!(f.matches[0].match_ranges, vec![(0, 5)]);
        assert_eq!(f.matches[1].line_number, 3);
        assert_eq!(f.matches[1].match_ranges, vec![(0, 5)]);
        assert!(!resp.truncated);
    }
}
```

- [ ] **Step 2: Run the test to confirm it fails**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib search::tests::finds_literal_match_in_single_file
cd ..
```

Expected: FAIL — the stub returns an empty `files` vec, so `resp.files.len()` is 0.

- [ ] **Step 3: Implement `find_in_folder` minimally**

Replace the stub `find_in_folder` body in `src-tauri/src/search.rs` with:

```rust
pub fn find_in_folder(
    folder: &Path,
    query: &str,
    opts: &FindOptions,
) -> Result<FindResponse, FindError> {
    use std::sync::{Arc, Mutex};
    use std::sync::atomic::{AtomicUsize, Ordering};

    use grep_regex::RegexMatcherBuilder;
    use grep_searcher::{Searcher, SearcherBuilder, Sink, SinkMatch};
    use grep_searcher::BinaryDetection;
    use ignore::WalkBuilder;

    if !folder.exists() {
        return Err(FindError::WorkspaceMissing);
    }

    let started = std::time::Instant::now();

    let pattern = if opts.regex { query.to_string() } else { regex::escape(query) };
    let pattern = if opts.whole_word { format!(r"\b(?:{})\b", pattern) } else { pattern };

    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(!opts.case_sensitive)
        .build(&pattern)
        .map_err(|e| FindError::InvalidRegex(e.to_string()))?;

    let total = Arc::new(AtomicUsize::new(0));
    let files: Arc<Mutex<Vec<FileMatch>>> = Arc::new(Mutex::new(Vec::new()));

    struct CollectSink<'a> {
        matcher: &'a grep_regex::RegexMatcher,
        path: String,
        matches: Vec<LineMatch>,
        total: Arc<AtomicUsize>,
    }

    impl<'a> Sink for CollectSink<'a> {
        type Error = std::io::Error;
        fn matched(&mut self, _searcher: &Searcher, mat: &SinkMatch<'_>) -> Result<bool, std::io::Error> {
            use grep::matcher::Matcher;
            let line_number = mat.line_number().unwrap_or(0) as u32;
            // mat.bytes() may include the trailing \n; trim it for display.
            let raw = mat.bytes();
            let trim_len = if raw.ends_with(b"\n") { raw.len() - 1 } else { raw.len() };
            let line_text = String::from_utf8_lossy(&raw[..trim_len]).into_owned();

            let mut ranges = Vec::new();
            // Find every match within the line text.
            self.matcher
                .find_iter(&raw[..trim_len], |m| {
                    ranges.push((m.start() as u32, m.end() as u32));
                    true
                })
                .ok();

            self.matches.push(LineMatch { line_number, line_text, match_ranges: ranges });
            let now = self.total.fetch_add(1, Ordering::Relaxed) + 1;
            Ok(now < MAX_MATCHES)
        }
    }

    let mut walker = WalkBuilder::new(folder);
    walker.standard_filters(true);
    let walker = walker.build();

    for entry in walker {
        if total.load(Ordering::Relaxed) >= MAX_MATCHES { break; }
        let entry = match entry { Ok(e) => e, Err(_) => continue };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) { continue; }

        let path_str = entry.path().to_string_lossy().to_string();
        let mut sink = CollectSink {
            matcher: &matcher,
            path: path_str.clone(),
            matches: Vec::new(),
            total: total.clone(),
        };

        let mut searcher = SearcherBuilder::new()
            .binary_detection(BinaryDetection::quit(b'\x00'))
            .line_number(true)
            .build();
        if searcher.search_path(&matcher, entry.path(), &mut sink).is_err() {
            continue;
        }
        if !sink.matches.is_empty() {
            files.lock().unwrap().push(FileMatch { path: sink.path, matches: sink.matches });
        }
    }

    let mut files = Arc::try_unwrap(files).unwrap().into_inner().unwrap();
    files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(FindResponse {
        files,
        truncated: total.load(Ordering::Relaxed) >= MAX_MATCHES,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}
```

Add `regex = "1"` to `src-tauri/Cargo.toml` under `[dependencies]` (it's a transitive dep already, but we use it directly via `regex::escape`):

```toml
regex = "1"
```

- [ ] **Step 4: Run the test to confirm it passes**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib search::tests::finds_literal_match_in_single_file
cd ..
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/search.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "search: implement find_in_folder literal match"
```

---

## Task 4: Respect `.gitignore`

**Files:**
- Modify: `src-tauri/src/search.rs`

- [ ] **Step 1: Add the gitignore test**

Append inside `mod tests`:

```rust
#[test]
fn respects_gitignore() {
    let dir = tmp("gitignore");
    write(&dir, ".gitignore", "target/\n");
    write(&dir, "src/lib.rs", "fn alpha() {}\n");
    write(&dir, "target/debug/build.rs", "fn alpha() {}\n");

    let resp = find_in_folder(&dir, "alpha", &FindOptions::default()).unwrap();

    assert_eq!(resp.files.len(), 1);
    assert!(resp.files[0].path.replace('\\', "/").ends_with("src/lib.rs"));
}
```

- [ ] **Step 2: Run it — it should already pass**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib search::tests::respects_gitignore
cd ..
```

Expected: PASS. The `standard_filters(true)` call (`WalkBuilder` default) reads `.gitignore`, `.ignore`, hidden files, etc. If this fails the walker config is wrong — `standard_filters(true)` must be present.

But — there is one gotcha: `ignore::WalkBuilder` only honors `.gitignore` inside a *git repository* by default (it looks for `.git`). Add the override toggle:

In `find_in_folder`, change:

```rust
let mut walker = WalkBuilder::new(folder);
walker.standard_filters(true);
```

to:

```rust
let mut walker = WalkBuilder::new(folder);
walker.standard_filters(true);
walker.require_git(false); // honor .gitignore even outside a git repo
```

- [ ] **Step 3: Re-run the test to confirm it now passes**

```powershell
cd src-tauri
cargo test --lib search::tests::respects_gitignore
cd ..
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/search.rs
git commit -m "search: respect .gitignore without requiring a git repo"
```

---

## Task 5: Case-sensitivity, regex, and whole-word toggles

**Files:**
- Modify: `src-tauri/src/search.rs`

- [ ] **Step 1: Add three tests**

Append inside `mod tests`:

```rust
#[test]
fn case_sensitive_toggle() {
    let dir = tmp("case");
    write(&dir, "a.txt", "Alpha\nalpha\n");

    let insensitive = find_in_folder(
        &dir, "alpha",
        &FindOptions { case_sensitive: false, ..Default::default() },
    ).unwrap();
    assert_eq!(insensitive.files[0].matches.len(), 2);

    let sensitive = find_in_folder(
        &dir, "alpha",
        &FindOptions { case_sensitive: true, ..Default::default() },
    ).unwrap();
    assert_eq!(sensitive.files[0].matches.len(), 1);
    assert_eq!(sensitive.files[0].matches[0].line_text, "alpha");
}

#[test]
fn regex_toggle_escapes_literals() {
    let dir = tmp("regex");
    write(&dir, "a.txt", "a.b\naXb\n");

    // Without regex, `a.b` is a literal — only the first line matches.
    let lit = find_in_folder(
        &dir, "a.b",
        &FindOptions { regex: false, ..Default::default() },
    ).unwrap();
    assert_eq!(lit.files[0].matches.len(), 1);
    assert_eq!(lit.files[0].matches[0].line_text, "a.b");

    // With regex, `a.b` matches both.
    let re = find_in_folder(
        &dir, "a.b",
        &FindOptions { regex: true, ..Default::default() },
    ).unwrap();
    assert_eq!(re.files[0].matches.len(), 2);
}

#[test]
fn whole_word_toggle() {
    let dir = tmp("word");
    write(&dir, "a.txt", "foo\nfood\n");

    let any = find_in_folder(
        &dir, "foo",
        &FindOptions { whole_word: false, ..Default::default() },
    ).unwrap();
    assert_eq!(any.files[0].matches.len(), 2);

    let word = find_in_folder(
        &dir, "foo",
        &FindOptions { whole_word: true, ..Default::default() },
    ).unwrap();
    assert_eq!(word.files[0].matches.len(), 1);
    assert_eq!(word.files[0].matches[0].line_text, "foo");
}
```

- [ ] **Step 2: Run them**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib search::tests::case_sensitive_toggle
cargo test --lib search::tests::regex_toggle_escapes_literals
cargo test --lib search::tests::whole_word_toggle
cd ..
```

Expected: all PASS — the implementation already wires `case_insensitive`, `regex::escape`, and `\b…\b` wrapping.

- [ ] **Step 3: Commit**

```powershell
git add src-tauri/src/search.rs
git commit -m "search: tests for case/regex/whole-word toggles"
```

---

## Task 6: Invalid regex → `FindError::InvalidRegex`

**Files:**
- Modify: `src-tauri/src/search.rs`

- [ ] **Step 1: Add the test**

Append inside `mod tests`:

```rust
#[test]
fn invalid_regex_returns_error() {
    let dir = tmp("badrx");
    write(&dir, "a.txt", "anything\n");

    let err = find_in_folder(
        &dir, "foo(",
        &FindOptions { regex: true, ..Default::default() },
    ).unwrap_err();

    match err {
        FindError::InvalidRegex(_) => {}
        other => panic!("expected InvalidRegex, got {:?}", other),
    }
}
```

- [ ] **Step 2: Run it**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib search::tests::invalid_regex_returns_error
cd ..
```

Expected: PASS (the existing `.map_err(|e| FindError::InvalidRegex(e.to_string()))` line already handles this).

- [ ] **Step 3: Commit**

```powershell
git add src-tauri/src/search.rs
git commit -m "search: test invalid_regex_returns_error"
```

---

## Task 7: 10,000-match cap + binary skip + workspace-missing

**Files:**
- Modify: `src-tauri/src/search.rs`

- [ ] **Step 1: Add three tests**

Append inside `mod tests`:

```rust
#[test]
fn truncates_at_max_matches() {
    let dir = tmp("cap");
    // 10_500 lines all containing "foo".
    let mut content = String::new();
    for _ in 0..10_500 { content.push_str("foo\n"); }
    write(&dir, "a.txt", &content);

    let resp = find_in_folder(&dir, "foo", &FindOptions::default()).unwrap();
    let total: usize = resp.files.iter().map(|f| f.matches.len()).sum();
    assert!(resp.truncated, "expected truncated flag");
    assert!(total <= MAX_MATCHES, "got {} matches, cap is {}", total, MAX_MATCHES);
    assert!(total >= MAX_MATCHES - 100, "got far fewer than the cap: {}", total);
}

#[test]
fn skips_binary_files() {
    let dir = tmp("binary");
    // Embed a NUL byte to mark the file binary. ripgrep's BinaryDetection::quit(0)
    // bails on the first NUL.
    let mut bytes: Vec<u8> = b"foo\nfoo".to_vec();
    bytes.insert(3, 0u8); // \0 between "foo" and "\nfoo"
    std::fs::write(dir.join("bin.dat"), bytes).unwrap();
    write(&dir, "good.txt", "foo\nfoo\n");

    let resp = find_in_folder(&dir, "foo", &FindOptions::default()).unwrap();
    assert_eq!(resp.files.len(), 1);
    assert!(resp.files[0].path.ends_with("good.txt"));
}

#[test]
fn workspace_missing_returns_error() {
    let missing = std::env::temp_dir().join("memopad_search_does_not_exist_xyz");
    // Make sure it's really gone.
    let _ = std::fs::remove_dir_all(&missing);

    let err = find_in_folder(&missing, "foo", &FindOptions::default()).unwrap_err();
    match err {
        FindError::WorkspaceMissing => {}
        other => panic!("expected WorkspaceMissing, got {:?}", other),
    }
}
```

- [ ] **Step 2: Run them**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib search::tests::truncates_at_max_matches
cargo test --lib search::tests::skips_binary_files
cargo test --lib search::tests::workspace_missing_returns_error
cd ..
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```powershell
git add src-tauri/src/search.rs
git commit -m "search: tests for 10k cap, binary skip, workspace missing"
```

---

## Task 8: Wire `find_in_folder` as a Tauri command

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command wrapper and register it**

Open `src-tauri/src/lib.rs`. After the `stat_file` command (around line 97-99), add:

```rust
#[tauri::command]
fn find_in_folder(
    folder: String,
    query: String,
    opts: search::FindOptions,
) -> Result<search::FindResponse, String> {
    search::find_in_folder(std::path::Path::new(&folder), &query, &opts)
        .map_err(|e| e.to_string())
}
```

In the `invoke_handler!` macro list (around line 107-121), the existing last entry is `stat_file,`. Add `find_in_folder` after it so the block reads:

```rust
        .invoke_handler(tauri::generate_handler![
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_is_maximized,
            reveal_in_explorer,
            fs::open_file,
            fs::save_file,
            journal_snapshot,
            journal_replay,
            journal_clear,
            session_save,
            session_load,
            stat_file,
            find_in_folder,
        ])
```

- [ ] **Step 2: Verify it compiles**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo check
cd ..
```

Expected: clean compile.

- [ ] **Step 3: Commit**

```powershell
git add src-tauri/src/lib.rs
git commit -m "search: register find_in_folder Tauri command"
```

---

## Task 9: `SessionState` gains `workspace_folder` (backward compatible)

**Files:**
- Modify: `src-tauri/src/session.rs`

- [ ] **Step 1: Add the field with `serde(default)`**

In `src-tauri/src/session.rs`, change the `SessionState` struct and `Default` impl:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionState {
    pub tabs: Vec<TabEntry>,
    pub active_id: Option<String>,
    #[serde(default)]
    pub workspace_folder: Option<String>,
}

impl Default for SessionState {
    fn default() -> Self {
        Self { tabs: Vec::new(), active_id: None, workspace_folder: None }
    }
}
```

- [ ] **Step 2: Add a backward-compat test**

In the existing `#[cfg(test)] mod tests` block in `session.rs`, append:

```rust
#[test]
fn loads_old_session_without_workspace_folder() {
    let dir = tmp();
    let legacy = r#"{"tabs":[{"buffer_id":"b1","path":"/a.txt"}],"active_id":"b1"}"#;
    std::fs::write(session_path(&dir), legacy).unwrap();
    let loaded = load_at(&dir);
    assert_eq!(loaded.workspace_folder, None);
    assert_eq!(loaded.tabs.len(), 1);
}

#[test]
fn round_trips_workspace_folder() {
    let dir = tmp();
    let state = SessionState {
        tabs: vec![],
        active_id: None,
        workspace_folder: Some("C:\\proj".into()),
    };
    save_at(&dir, &state).unwrap();
    assert_eq!(load_at(&dir).workspace_folder, Some("C:\\proj".into()));
}
```

- [ ] **Step 3: Update existing tests that construct `SessionState`**

The existing `round_trip_via_save_then_load` and `save_overwrites_previous` tests construct `SessionState` literally. They'll fail to compile because the new field is required. Add `workspace_folder: None` to each `SessionState { ... }` literal in `session.rs`.

Run a find to confirm you got all of them:

```powershell
findstr /N "SessionState {" src-tauri\src\session.rs
```

Add `workspace_folder: None,` to every struct literal printed.

- [ ] **Step 4: Run the session tests**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib session::
cd ..
```

Expected: all session tests pass (5 of them).

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/session.rs
git commit -m "session: add backward-compatible workspace_folder field"
```

---

## Task 10: Frontend IPC wrapper + types

**Files:**
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Read the existing file to find the right insertion point**

```powershell
findstr /N "^export" src\lib\tauri.ts
```

Identify the last `export` block in the file. The new wrapper appends after it.

- [ ] **Step 2: Append the new types and wrapper**

At the bottom of `src/lib/tauri.ts`:

```ts
export interface FindOptions {
  regex: boolean;
  case_sensitive: boolean;
  whole_word: boolean;
}

export interface LineMatch {
  line_number: number;
  line_text: string;
  match_ranges: [number, number][];
}

export interface FileMatch {
  path: string;
  matches: LineMatch[];
}

export interface FindResponse {
  files: FileMatch[];
  truncated: boolean;
  elapsed_ms: number;
  /** Frontend-only field populated by the workspace store when find_in_folder rejects. */
  error?: string;
}

export async function findInFolder(
  folder: string,
  query: string,
  opts: FindOptions,
): Promise<FindResponse> {
  return invoke<FindResponse>('find_in_folder', { folder, query, opts });
}
```

If `invoke` isn't already imported at the top of the file, leave its import alone — the existing wrappers in this file already import it. (If somehow it isn't, add `import { invoke } from '@tauri-apps/api/core';` to the top.)

- [ ] **Step 3: Type-check**

```powershell
npx tsc --noEmit
```

Expected: clean — no new errors.

- [ ] **Step 4: Commit**

```powershell
git add src/lib/tauri.ts
git commit -m "tauri: typed findInFolder IPC wrapper"
```

---

## Task 11: Workspace store skeleton + `openFolder`

**Files:**
- Create: `src/stores/workspace.ts`
- Create: `src/tests/workspace.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/workspace.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useWorkspace } from '../stores/workspace';

beforeEach(() => {
  useWorkspace.setState({
    workspaceFolder: null,
    results: null,
    inFlight: false,
    lastQuery: '',
    lastOpts: { regex: false, case_sensitive: false, whole_word: false },
  } as never, true);
  vi.clearAllMocks();
});

describe('useWorkspace.openFolder', () => {
  it('persists the picked path into workspaceFolder', async () => {
    (openDialog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('C:/some/proj');
    await useWorkspace.getState().openFolder();
    expect(useWorkspace.getState().workspaceFolder).toBe('C:/some/proj');
  });

  it('leaves state unchanged if the user cancels the dialog', async () => {
    (openDialog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await useWorkspace.getState().openFolder();
    expect(useWorkspace.getState().workspaceFolder).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```powershell
npm test -- workspace
```

Expected: FAIL — `useWorkspace` doesn't exist.

- [ ] **Step 3: Create the store**

Create `src/stores/workspace.ts`:

```ts
import { create } from 'zustand';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { findInFolder, type FindOptions, type FindResponse } from '../lib/tauri';

interface WorkspaceState {
  workspaceFolder: string | null;
  results: FindResponse | null;
  inFlight: boolean;
  lastQuery: string;
  lastOpts: FindOptions;
  /** Monotonic counter to drop stale search responses. */
  requestId: number;

  openFolder: () => Promise<void>;
  closeFolder: () => void;
  runSearch: (query: string, opts: FindOptions) => Promise<void>;
  clearResults: () => void;
  setFolder: (folder: string | null) => void;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  workspaceFolder: null,
  results: null,
  inFlight: false,
  lastQuery: '',
  lastOpts: { regex: false, case_sensitive: false, whole_word: false },
  requestId: 0,

  async openFolder() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === 'string') {
      set({ workspaceFolder: picked, results: null });
    }
  },

  closeFolder() {
    set({ workspaceFolder: null, results: null, inFlight: false });
  },

  async runSearch(query, opts) {
    const folder = get().workspaceFolder;
    if (!folder) return;
    if (query.trim() === '') { set({ results: null, lastQuery: query, lastOpts: opts }); return; }

    const id = get().requestId + 1;
    set({ requestId: id, inFlight: true, lastQuery: query, lastOpts: opts });
    try {
      const resp = await findInFolder(folder, query, opts);
      if (get().requestId !== id) return; // stale
      set({ results: resp, inFlight: false });
    } catch (err) {
      if (get().requestId !== id) return;
      set({ results: { files: [], truncated: false, elapsed_ms: 0, error: (err as Error).message }, inFlight: false });
    }
  },

  clearResults() { set({ results: null }); },
  setFolder(folder) { set({ workspaceFolder: folder }); },
}));
```

- [ ] **Step 4: Run the test**

```powershell
npm test -- workspace
```

Expected: PASS — both `openFolder` cases.

- [ ] **Step 5: Commit**

```powershell
git add src/stores/workspace.ts src/tests/workspace.test.ts
git commit -m "workspace: store skeleton + openFolder"
```

---

## Task 12: Workspace store `runSearch` (stale-drop + empty query)

**Files:**
- Modify: `src/tests/workspace.test.ts`

- [ ] **Step 1: Add three runSearch tests**

Append to `src/tests/workspace.test.ts` (inside the file, after the existing `describe`):

```ts
describe('useWorkspace.runSearch', () => {
  function defaultOpts(): import('../lib/tauri').FindOptions {
    return { regex: false, case_sensitive: false, whole_word: false };
  }

  it('does nothing when query is whitespace', async () => {
    useWorkspace.setState({ workspaceFolder: 'C:/proj' } as never);
    await useWorkspace.getState().runSearch('   ', defaultOpts());
    expect(invoke).not.toHaveBeenCalled();
    expect(useWorkspace.getState().results).toBeNull();
  });

  it('does nothing when no workspace folder is set', async () => {
    await useWorkspace.getState().runSearch('foo', defaultOpts());
    expect(invoke).not.toHaveBeenCalled();
  });

  it('drops a stale response when a newer search has started', async () => {
    useWorkspace.setState({ workspaceFolder: 'C:/proj' } as never);
    const slow = new Promise((resolve) => setTimeout(() => resolve({
      files: [{ path: 'a', matches: [] }], truncated: false, elapsed_ms: 10,
    }), 50));
    const fast = Promise.resolve({
      files: [{ path: 'b', matches: [] }], truncated: false, elapsed_ms: 1,
    });
    (invoke as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(slow);
    (invoke as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(fast);

    const slowCall = useWorkspace.getState().runSearch('aaa', defaultOpts());
    const fastCall = useWorkspace.getState().runSearch('bbb', defaultOpts());
    await Promise.all([slowCall, fastCall]);

    const results = useWorkspace.getState().results;
    expect(results?.files[0]?.path).toBe('b');
  });
});
```

- [ ] **Step 2: Run the tests**

```powershell
npm test -- workspace
```

Expected: all PASS (5 total in workspace.test.ts now). If the stale-drop test races, increase the slow timeout from 50 to 100.

- [ ] **Step 3: Commit**

```powershell
git add src/tests/workspace.test.ts
git commit -m "workspace: tests for empty-query/no-folder/stale-drop runSearch"
```

---

## Task 13: `buffers.openFileAtLine`

**Files:**
- Modify: `src/stores/buffers.ts`
- Modify: `src/tests/buffers.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `src/tests/buffers.test.ts`:

```ts
describe('openFileAtLine', () => {
  it('reuses an existing tab when the path is already open', () => {
    const id = useBuffers.getState().openBuffer({
      path: 'C:/a.txt', content: 'line1\nline2\n', encoding: 'utf-8', eol: 'lf',
    });
    useBuffers.getState().newBuffer(); // create a second tab and switch to it
    expect(useBuffers.getState().activeId).not.toBe(id);

    useBuffers.getState().openFileAtLine('C:/a.txt', 2, [0, 4], 'line2');

    expect(useBuffers.getState().activeId).toBe(id);
  });
});
```

- [ ] **Step 2: Run it — should fail**

```powershell
npm test -- buffers
```

Expected: FAIL — `openFileAtLine` doesn't exist.

- [ ] **Step 3: Add the action**

In `src/stores/buffers.ts`, extend `BuffersState` interface:

```ts
  openFileAtLine: (
    path: string,
    line: number,
    range: [number, number],
    snippet: string,
  ) => void;
```

In the store implementation (the `create<BuffersState>((set, get) => ({ ... }))` block), add:

```ts
  openFileAtLine(path, line, range, _snippet) {
    const existing = get().buffers.find((b) => b.path === path);
    if (existing) {
      set({ activeId: existing.id });
    } else {
      // Defer file open to the caller (must go through fs::open_file IPC).
      // For now, signal intent via a window-level event consumed by SearchPanel.
      (window as unknown as { __memopadPendingJump?: { path: string; line: number; range: [number, number] } }).__memopadPendingJump = { path, line, range };
    }
    (window as unknown as {
      __memopadJumpEditor?: (line: number, range: [number, number]) => void;
    }).__memopadJumpEditor?.(line, range);
  },
```

Rationale: opening a NEW file goes through async IPC (`fs::open_file`), which the store doesn't do directly — the existing `file.open` command in `builtins.ts` is the seam. `openFileAtLine` is only responsible for switching to an already-open tab plus dispatching the editor jump. SearchPanel handles the "file not yet open" case by running `file.open` for the path first, then calling `openFileAtLine`.

- [ ] **Step 4: Run the test**

```powershell
npm test -- buffers
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/stores/buffers.ts src/tests/buffers.test.ts
git commit -m "buffers: openFileAtLine reuses existing tab"
```

---

## Task 14: Sidebar component shell + empty state

**Files:**
- Create: `src/components/Sidebar.tsx`

- [ ] **Step 1: Create the component**

`src/components/Sidebar.tsx`:

```tsx
import { useWorkspace } from '../stores/workspace';
import { SearchPanel } from './SearchPanel';

interface Props {
  open: boolean;
  onOpenFolder: () => void;
}

export function Sidebar({ open, onOpenFolder }: Props) {
  const folder = useWorkspace((s) => s.workspaceFolder);
  if (!open) return null;
  return (
    <aside
      data-testid="sidebar"
      className="flex w-[280px] shrink-0 flex-col border-r border-neutral-700 bg-neutral-900 text-neutral-200"
    >
      <div className="border-b border-neutral-700 px-3 py-2 text-xs uppercase tracking-wide text-neutral-400">
        Search
      </div>
      {folder ? (
        <SearchPanel />
      ) : (
        <div className="flex flex-1 flex-col items-start gap-3 p-4 text-sm text-neutral-400">
          <p>Open a folder to search across files.</p>
          <button
            type="button"
            onClick={onOpenFolder}
            className="rounded bg-neutral-700 px-3 py-1 text-neutral-100 hover:bg-neutral-600"
          >
            Open folder…
          </button>
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Create a placeholder `SearchPanel.tsx` so the build doesn't break**

Create `src/components/SearchPanel.tsx`:

```tsx
export function SearchPanel() {
  return <div data-testid="search-panel" className="flex-1 p-3 text-sm text-neutral-300">Search panel pending.</div>;
}
```

- [ ] **Step 3: Type-check**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```powershell
git add src/components/Sidebar.tsx src/components/SearchPanel.tsx
git commit -m "ui: Sidebar shell with empty state"
```

---

## Task 15: SearchPanel — input + toggles + debounced search

**Files:**
- Modify: `src/components/SearchPanel.tsx`

- [ ] **Step 1: Replace the placeholder with the full panel**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import type { FindOptions } from '../lib/tauri';

const DEBOUNCE_MS = 200;

export function SearchPanel() {
  const folder = useWorkspace((s) => s.workspaceFolder);
  const results = useWorkspace((s) => s.results);
  const inFlight = useWorkspace((s) => s.inFlight);
  const runSearch = useWorkspace((s) => s.runSearch);
  const closeFolder = useWorkspace((s) => s.closeFolder);

  const [query, setQuery] = useState('');
  const [opts, setOpts] = useState<FindOptions>({
    regex: false, case_sensitive: false, whole_word: false,
  });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      runSearch(query, opts).catch(() => {});
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, opts, runSearch]);

  useEffect(() => {
    (window as unknown as { __memopadFocusFindInFiles?: () => void }).__memopadFocusFindInFiles = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
  }, []);

  return (
    <div data-testid="search-panel" className="flex flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-700 px-3 py-2">
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
      <div className="flex items-center gap-1 border-b border-neutral-700 px-3 py-1 text-xs">
        <Toggle label="Aa" title="Case sensitive" active={opts.case_sensitive}
          onClick={() => setOpts({ ...opts, case_sensitive: !opts.case_sensitive })}
        />
        <Toggle label=".*" title="Regex" active={opts.regex}
          onClick={() => setOpts({ ...opts, regex: !opts.regex })}
        />
        <Toggle label="\b" title="Whole word" active={opts.whole_word}
          onClick={() => setOpts({ ...opts, whole_word: !opts.whole_word })}
        />
        <span className="ml-auto truncate text-neutral-500" title={folder ?? ''}>
          {folder?.split(/[/\\]/).slice(-2).join('/') ?? ''}
        </span>
        <button
          type="button"
          onClick={closeFolder}
          title="Close folder"
          className="rounded px-1 text-neutral-500 hover:text-neutral-200"
        >×</button>
      </div>
      <ResultsBody inFlight={inFlight} results={results} />
    </div>
  );
}

function Toggle({ label, title, active, onClick }: { label: string; title: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      data-active={active}
      className={`rounded px-1.5 py-0.5 font-mono ${
        active
          ? 'bg-neutral-200 text-neutral-900'
          : 'text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100'
      }`}
    >
      {label}
    </button>
  );
}

function ResultsBody({ inFlight, results }: { inFlight: boolean; results: import('../lib/tauri').FindResponse | null }) {
  // Filled in by Task 16.
  if (inFlight && !results) return <div className="p-3 text-xs text-neutral-500">Searching…</div>;
  if (!results) return <div className="p-3 text-xs text-neutral-500">Type to search.</div>;
  return <div className="p-3 text-xs text-neutral-500">{results.files.length} files</div>;
}
```

- [ ] **Step 2: Type-check**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```powershell
git add src/components/SearchPanel.tsx
git commit -m "ui: SearchPanel input + toggles + debounced runSearch"
```

---

## Task 16: SearchPanel — results list + status line + click

**Files:**
- Modify: `src/components/SearchPanel.tsx`

- [ ] **Step 1: Replace the `ResultsBody` stub with the full list**

In `src/components/SearchPanel.tsx`, replace the existing `ResultsBody` function with:

```tsx
import { openFile as openFileIpc } from '../lib/tauri';
import { useBuffers } from '../stores/buffers';
import type { FindResponse, FileMatch, LineMatch } from '../lib/tauri';

function ResultsBody({ inFlight, results }: { inFlight: boolean; results: FindResponse | null }) {
  if (inFlight && !results) return <div className="p-3 text-xs text-neutral-500">Searching…</div>;
  if (!results) return <div className="p-3 text-xs text-neutral-500">Type to search.</div>;
  if (results.error) return <div data-testid="search-error" className="p-3 text-xs text-red-400">{results.error}</div>;
  if (results.files.length === 0) return <div className="p-3 text-xs text-neutral-500">No matches.</div>;

  const total = results.files.reduce((n, f) => n + f.matches.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-auto">
        {results.files.map((f) => (
          <FileGroup key={f.path} file={f} />
        ))}
      </div>
      <div
        data-testid="search-status"
        className={`border-t border-neutral-700 px-3 py-1 text-xs ${
          results.truncated ? 'text-amber-400' : 'text-neutral-500'
        }`}
      >
        {results.truncated
          ? `${total.toLocaleString()}+ matches — refine your query`
          : `${total.toLocaleString()} match${total === 1 ? '' : 'es'} in ${results.files.length} file${results.files.length === 1 ? '' : 's'}`}
      </div>
    </div>
  );
}

function FileGroup({ file }: { file: FileMatch }) {
  const short = file.path.split(/[/\\]/).pop() ?? file.path;
  return (
    <div className="border-b border-neutral-800">
      <div className="truncate px-3 py-1 text-xs text-neutral-400" title={file.path}>{short}</div>
      <ul>
        {file.matches.map((m, i) => (
          <li key={i}>
            <ResultRow path={file.path} match={m} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultRow({ path, match }: { path: string; match: LineMatch }) {
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
      <Snippet text={match.line_text} ranges={match.match_ranges} />
    </button>
  );
}

function Snippet({ text, ranges }: { text: string; ranges: [number, number][] }) {
  if (ranges.length === 0) return <span>{text}</span>;
  const parts: JSX.Element[] = [];
  let cursor = 0;
  ranges.forEach(([s, e], i) => {
    if (s > cursor) parts.push(<span key={`p${i}`}>{text.slice(cursor, s)}</span>);
    parts.push(<mark key={`m${i}`} className="bg-amber-400/30 text-amber-200">{text.slice(s, e)}</mark>);
    cursor = e;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{parts}</>;
}
```

Verify `openFile` is exported from `src/lib/tauri.ts` (it should already be — used by the `file.open` command). If the import name differs, adjust the import line accordingly.

- [ ] **Step 2: Type-check**

```powershell
npx tsc --noEmit
```

Expected: clean. If `JSX.Element` type errors come up, add `import { type JSX } from 'react';` to the top of the file.

- [ ] **Step 3: Commit**

```powershell
git add src/components/SearchPanel.tsx
git commit -m "ui: SearchPanel results list + status line + click-to-open"
```

---

## Task 17: TitleBar sidebar-toggle + `view.toggleSidebar` command

**Files:**
- Modify: `src/components/TitleBar.tsx`
- Modify: `src/commands/builtins.ts`

- [ ] **Step 1: Add a tiny sidebar-toggle button to TitleBar**

Open `src/components/TitleBar.tsx`. Near the left side (before the tab strip), add a button that fires `view.toggleSidebar`. Find the existing leftmost container and prepend:

```tsx
<button
  type="button"
  title="Toggle sidebar (Ctrl+B)"
  data-testid="sidebar-toggle"
  onClick={() => (window as unknown as { __memopadToggleSidebar?: () => void }).__memopadToggleSidebar?.()}
  className="ml-1 mr-2 rounded px-1.5 text-neutral-400 hover:text-neutral-100"
>
  ☰
</button>
```

(The exact JSX placement: open the file and put the button as the first child of whatever flex container holds the title bar contents on the left. If TitleBar exposes a `data-tauri-drag-region` parent, the button must be a non-drag child — same pattern existing icon buttons use.)

- [ ] **Step 2: Register the new commands in `builtins.ts`**

In `src/commands/builtins.ts`, find the existing `register({ ... })` calls. Add at the end of `registerBuiltins`:

```ts
  register({
    id: 'workspace.openFolder',
    title: 'Open Folder…',
    run: () => {
      import('../stores/workspace').then(({ useWorkspace }) => {
        useWorkspace.getState().openFolder().catch(() => {});
      });
    },
  });

  register({
    id: 'workspace.closeFolder',
    title: 'Close Folder',
    run: () => {
      import('../stores/workspace').then(({ useWorkspace }) => {
        useWorkspace.getState().closeFolder();
      });
    },
  });

  register({
    id: 'view.toggleSidebar',
    title: 'Toggle Sidebar',
    run: () => {
      (window as unknown as { __memopadToggleSidebar?: () => void }).__memopadToggleSidebar?.();
    },
  });

  register({
    id: 'search.focusFindInFiles',
    title: 'Find in Files',
    run: () => {
      (window as unknown as { __memopadOpenSidebarAndFocusFind?: () => void }).__memopadOpenSidebarAndFocusFind?.();
    },
  });
```

- [ ] **Step 3: Type-check**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```powershell
git add src/components/TitleBar.tsx src/commands/builtins.ts
git commit -m "ui: TitleBar sidebar toggle + workspace/view/search commands"
```

---

## Task 18: Mount Sidebar in App.tsx + wire keybindings + boot rehydrate

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/lib/boot.ts`

- [ ] **Step 1: Boot rehydrate the workspace folder**

Open `src/lib/boot.ts`. Find the spot where it processes `session_load` output (the function that reads the session and populates the buffers store). After it sets buffers, add a line to populate the workspace:

```ts
import { useWorkspace } from '../stores/workspace';
// …
if (session.workspace_folder) {
  useWorkspace.getState().setFolder(session.workspace_folder);
}
```

(If the session type doesn't already include `workspace_folder`, extend the TS interface in `src/lib/tauri.ts` where `SessionState` is typed.)

Add `workspace_folder?: string | null;` to that interface.

- [ ] **Step 2: Extend `persistSession` in App.tsx to include workspace_folder**

In `src/App.tsx`, the existing `persistSession` function reads `useBuffers.getState()`. Modify it to also pull the workspace folder:

```ts
function persistSession() {
  const state = useBuffers.getState();
  const folder = useWorkspace.getState().workspaceFolder;
  scheduleSessionSave({
    tabs: state.buffers.map((b) => ({ buffer_id: b.id, path: b.path })),
    active_id: state.activeId,
    workspace_folder: folder,
  });
}
```

Import `useWorkspace` at the top of `App.tsx`:

```ts
import { useWorkspace } from './stores/workspace';
```

Also extend the `scheduleSessionSave` payload type if it's strictly typed — search for the function in `src/lib/session-debounce.ts` and add `workspace_folder?: string | null` to its parameter type.

- [ ] **Step 3: Mount Sidebar + wire window-level helpers**

In `App.tsx`, change the main layout to include Sidebar:

```tsx
import { Sidebar } from './components/Sidebar';
// …

export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // … existing effects unchanged …

  useEffect(() => {
    (window as unknown as { __memopadToggleSidebar?: () => void }).__memopadToggleSidebar = () => setSidebarOpen((v) => !v);
    (window as unknown as { __memopadOpenSidebarAndFocusFind?: () => void }).__memopadOpenSidebarAndFocusFind = () => {
      setSidebarOpen(true);
      requestAnimationFrame(() => {
        (window as unknown as { __memopadFocusFindInFiles?: () => void }).__memopadFocusFindInFiles?.();
      });
    };
  }, []);

  // existing useEffect that hooks keydown — add two cases at the top before
  // the existing `if (key === 'f' && !e.shiftKey)` line:
  // (inside the onKey function)
  //   if (key === 'b' && !e.shiftKey) { e.preventDefault(); setSidebarOpen((v) => !v); return; }
  //   if (key === 'f' && e.shiftKey)  { e.preventDefault(); (window as unknown as { __memopadOpenSidebarAndFocusFind?: () => void }).__memopadOpenSidebarAndFocusFind?.(); return; }

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <TitleBar />
      <UpdateBanner />
      <main className="flex flex-1 overflow-hidden">
        <Sidebar
          open={sidebarOpen}
          onOpenFolder={() => runCommand('workspace.openFolder')}
        />
        <div className="flex flex-1 w-full">
          <Editor />
        </div>
      </main>
      <StatusBar />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onRun={runCommand} />}
    </div>
  );
}
```

Within the existing `useEffect(() => { const onKey = …; … }, []);` block, add these two cases at the top of the `if (key === …) { … }` ladder (before the `if (key === 'f' && !e.shiftKey)` line):

```ts
if (key === 'b' && !e.shiftKey) { e.preventDefault(); setSidebarOpen((v) => !v); return; }
if (key === 'f' && e.shiftKey)  { e.preventDefault(); (window as unknown as { __memopadOpenSidebarAndFocusFind?: () => void }).__memopadOpenSidebarAndFocusFind?.(); return; }
```

Layout invariant: the inner `<div className="flex flex-1 w-full">` wrapping `<Editor />` is required so the editor still expands when the sidebar is mounted. Without it the editor collapses to content width on Windows + WebView2 (this is the Phase 4 bug class — there's an existing e2e layout-invariant test).

- [ ] **Step 4: Type-check**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Run all Vitest tests**

```powershell
npm test
```

Expected: existing 50 + new ones all pass.

- [ ] **Step 6: Commit**

```powershell
git add src/App.tsx src/lib/boot.ts src/lib/tauri.ts src/lib/session-debounce.ts
git commit -m "app: mount Sidebar; wire Ctrl+B / Ctrl+Shift+F; persist workspace_folder"
```

---

## Task 19: e2e fixture + 'opens folder' spec

**Files:**
- Create: `tests/e2e/fixtures/workspace/notes.txt`
- Create: `tests/e2e/fixtures/workspace/sub/code.rs`
- Create: `tests/e2e/find-in-files.spec.ts`

- [ ] **Step 1: Create fixture files**

`tests/e2e/fixtures/workspace/notes.txt`:

```
alpha beta
gamma alpha
delta epsilon
```

`tests/e2e/fixtures/workspace/sub/code.rs`:

```
fn alpha() { /* alpha */ }
fn beta() {}
```

- [ ] **Step 2: Add the spec (folder open + panel render)**

`tests/e2e/find-in-files.spec.ts`:

```ts
import { browser, $, expect } from '@wdio/globals';
import * as path from 'node:path';

const FIXTURE = path.resolve(__dirname, 'fixtures/workspace');

async function setMockFolder(folder: string) {
  await browser.execute((f) => {
    (window as unknown as { __memopadTestSetWorkspace?: (s: string) => void }).__memopadTestSetWorkspace?.(f);
  }, folder);
}

describe('find-in-files', () => {
  before(async () => {
    // App is already launched by the e2e harness.
  });

  it('opens the sidebar via Ctrl+B and shows the empty state', async () => {
    await browser.keys(['Control', 'b']);
    await browser.keys(['Control']);
    const sidebar = await $('[data-testid="sidebar"]');
    await expect(sidebar).toBeDisplayed();
    await expect(sidebar).toHaveText(expect.stringContaining('Open a folder'));
  });

  it('renders the search panel once a workspace folder is set', async () => {
    await setMockFolder(FIXTURE);
    const input = await $('[data-testid="search-input"]');
    await expect(input).toBeDisplayed();
  });
});
```

- [ ] **Step 3: Expose a test hook for setting the workspace folder**

In `src/App.tsx`, near the bottom where existing `__memopadTestRunCommand` is exported, add:

```ts
(window as unknown as { __memopadTestSetWorkspace?: (folder: string) => void }).__memopadTestSetWorkspace = (folder: string) => {
  useWorkspace.getState().setFolder(folder);
};
```

- [ ] **Step 4: Run the e2e suite**

```powershell
npm run e2e
```

Expected: 45 (existing) + 2 (new) e2e tests pass.

If the new tests fail because the sidebar already opened in a prior test or stale state leaks, prepend a `before` hook that toggles the sidebar closed first.

- [ ] **Step 5: Commit**

```powershell
git add tests/e2e/fixtures/workspace/ tests/e2e/find-in-files.spec.ts src/App.tsx
git commit -m "e2e: fixture folder + sidebar/SearchPanel render tests"
```

---

## Task 20: e2e — search renders results + click opens file at line

**Files:**
- Modify: `tests/e2e/find-in-files.spec.ts`

- [ ] **Step 1: Add two more it() blocks**

Append inside the existing `describe('find-in-files', …)` in `tests/e2e/find-in-files.spec.ts`:

```ts
it('renders results when query matches fixture content', async () => {
  const input = await $('[data-testid="search-input"]');
  await input.setValue('alpha');
  // 200ms debounce + IPC round-trip.
  await browser.pause(700);
  const rows = await $$('[data-testid="match-row"]');
  expect(rows.length).toBeGreaterThanOrEqual(3); // notes.txt has 2, code.rs has 2 (substring `alpha` appears 2x there too)
});

it('clicking a result opens the file at the match line', async () => {
  const rows = await $$('[data-testid="match-row"]');
  await rows[0].click();
  // The active editor should now show the file content.
  // We rely on TitleBar showing the active file name.
  const titleBar = await $('[data-tauri-drag-region]');
  await expect(titleBar).toHaveText(expect.stringMatching(/notes\.txt|code\.rs/));
});
```

- [ ] **Step 2: Run the e2e suite**

```powershell
npm run e2e
```

Expected: 45 + 4 = 49 e2e tests pass. If `$$` selector isn't recognized, switch to `await browser.$$(...)`.

- [ ] **Step 3: Commit**

```powershell
git add tests/e2e/find-in-files.spec.ts
git commit -m "e2e: search renders results + click opens file at line"
```

---

## Task 21: Manual smoke + Results doc

**Files:**
- Create: `docs/superpowers/plans/v2-find-in-files-results.md`

- [ ] **Step 1: Run the dev shell**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri dev
```

In the launched app:
1. Ctrl+B — sidebar opens, shows "Open a folder to search across files."
2. Click "Open folder…" — pick `E:\Github\memopad\src`.
3. Sidebar switches to the SearchPanel; type `buffer`.
4. After ~200 ms, results list should appear with hits in `stores/buffers.ts`, `App.tsx`, etc.
5. Click a result — that file opens in a new tab, cursor lands on the matched line, the match is briefly highlighted.
6. Toggle case (`Aa`), regex (`.*`), whole word (`\b`) — results update on each toggle.
7. Quit the app (close window). Reopen — the workspace folder should be remembered (SearchPanel renders immediately, no empty state).
8. Restart Memopad without changing anything else and confirm find-in-files still feels under 1 second on Memopad's own source tree.

- [ ] **Step 2: Run all automated gates**

```powershell
npm test
npx tsc --noEmit
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri; cargo test --lib; cd ..
npm run e2e
```

Expected:
- Vitest: 50 (existing) + new workspace tests + new buffers test ≈ 56+
- tsc: exit 0
- cargo: 51 (existing) + 8–9 new search tests + 2 new session tests ≈ 61–62
- e2e: 45 (existing) + 4 (new) = 49

- [ ] **Step 3: Write the results doc**

Create `docs/superpowers/plans/v2-find-in-files-results.md`:

```markdown
# v2 Find-in-Files — Results

## Automated test gates

- Vitest: <fill in actual> tests passing
- cargo test: <fill in actual> tests passing
- e2e (WebdriverIO): <fill in actual> tests passing
- tsc --noEmit: exit 0

## Build artifacts

- MSI size delta: <baseline 5.62 MB → new>
- app.exe size delta: <baseline 13.64 MB → new>

## What shipped

- `src-tauri/src/search.rs` — find_in_folder + 9 tests
- `src/stores/workspace.ts` — workspace store
- `src/components/Sidebar.tsx`, `src/components/SearchPanel.tsx`
- Session schema gained backward-compatible `workspace_folder`
- New commands: `workspace.openFolder`, `workspace.closeFolder`, `view.toggleSidebar`, `search.focusFindInFiles`
- Keybindings: Ctrl+B (toggle sidebar), Ctrl+Shift+F (open sidebar + focus find), Ctrl+K Ctrl+O (open folder)

## What is intentionally NOT in this slice

- Replace across files
- File tree sidebar
- Live cancellation (Rust walk runs to completion; frontend drops stale)
- Streaming results

## Follow-ups (next v2 slices)

1. File tree alongside SearchPanel in the same sidebar
2. Replace-in-files with preview/confirm
3. Recent folders list (Ctrl+R or palette)
```

Fill in the actual numbers after running the gates.

- [ ] **Step 4: Commit**

```powershell
git add docs/superpowers/plans/v2-find-in-files-results.md
git commit -m "v2 find-in-files: record results"
```

- [ ] **Step 5: Open a PR or merge to main**

If working on a feature branch:

```powershell
git push -u origin v2-find-in-files
gh pr create --title "v2: find in files" --body "Implements docs/superpowers/specs/2026-05-27-find-in-files-design.md"
```

Otherwise, merge to main and push.

---

## Self-review notes (don't delete)

**Spec coverage check:**

| Spec requirement | Covered by |
| --- | --- |
| Persistent workspace folder | Tasks 9, 11, 18 |
| ripgrep backend (grep + ignore crates) | Tasks 1, 3 |
| Left sidebar UI | Tasks 14, 17, 18 |
| `find_in_folder` command + types | Tasks 2, 3, 8 |
| Regex / case / whole-word toggles | Tasks 3, 5, 15 |
| .gitignore respected | Task 4 |
| Binary files skipped | Task 7 |
| 10,000-match cap + truncated flag | Tasks 3, 7, 16 |
| Invalid regex inline error | Tasks 6; surfaced in 11 (store catch), exposed by 15 (TODO: bind to inline UI) |
| Workspace-missing error | Task 7, surfaced by 11 |
| Stale-drop cancellation | Tasks 11, 12 |
| Empty query no-op | Task 12 |
| Jump-to-match opens / switches tab | Tasks 13, 16 |
| Persistence via session.json | Tasks 9, 18 |
| Ctrl+Shift+F / Ctrl+B / Ctrl+K Ctrl+O | Task 18 |
| 280px sidebar, collapsible | Task 14 |
| Status line truncated / counts | Task 16 |
| Vitest workspace tests | Tasks 11, 12 |
| Vitest buffers test | Task 13 |
| Cargo search tests | Tasks 3–7 |
| e2e fixture + 3 e2e tests | Tasks 19, 20 (4 tests total — 1 extra empty-state) |
| Smoke gate | Task 21 |

**Notes for executor:**
- The inline-error UI for invalid regex is built into Task 16's `ResultsBody` via the `data-testid="search-error"` branch. The `FindResponse` interface in Task 10 declares the optional `error` field that the workspace store populates from the `runSearch` catch block (Task 11).
- The `WorkspaceMissing` error string from Rust ("Folder no longer accessible") will surface the same way (via `runSearch` catch). The "open another folder" button described in the spec is NOT in this slice — the user can still pick a new folder via the empty-state path after `closeFolder()`. If you want to be tighter to the spec, add a small "Open folder…" button next to the error message in `ResultsBody` that calls `useWorkspace.getState().closeFolder()` then `useWorkspace.getState().openFolder()`. This is a 5-line UI tweak; either fold into Task 16 or leave for a polish slice.
