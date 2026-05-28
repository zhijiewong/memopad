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

/// Build the matcher pattern string used by both find and replace. Applies the
/// FindOptions flags consistently: literal-escape when regex is off, wrap with
/// `\b(?:…)\b` when whole_word is on. The case_sensitive flag is applied at
/// builder time by the caller (not in the pattern itself).
fn build_matcher_pattern(query: &str, opts: &FindOptions) -> String {
    let pattern = if opts.regex { query.to_string() } else { regex::escape(query) };
    if opts.whole_word { format!(r"\b(?:{})\b", pattern) } else { pattern }
}

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

    let pattern = build_matcher_pattern(query, opts);

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
            let raw = mat.bytes();
            let trim_len = if raw.ends_with(b"\n") { raw.len() - 1 } else { raw.len() };
            let line_text = String::from_utf8_lossy(&raw[..trim_len]).into_owned();

            let mut ranges = Vec::new();
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
    walker.require_git(false); // honor .gitignore even outside a git repo
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

pub fn replace_in_files(
    folder: &Path,
    query: &str,
    replacement: &str,
    opts: &FindOptions,
    target_paths: Option<&[String]>,
) -> Result<ReplaceResponse, FindError> {
    use grep_regex::RegexMatcherBuilder;

    if !folder.exists() {
        return Err(FindError::WorkspaceMissing);
    }

    let pattern = build_matcher_pattern(query, opts);

    // Build regex for replacement with backreferences
    let re = regex::RegexBuilder::new(&pattern)
        .case_insensitive(!opts.case_sensitive)
        .build()
        .map_err(|e| FindError::InvalidRegex(e.to_string()))?;

    // Get list of files to process
    let mut files_to_process = Vec::new();
    let walker = ignore::WalkBuilder::new(folder)
        .standard_filters(true)
        .require_git(false)
        .build();

    for entry in walker {
        let entry = match entry { Ok(e) => e, Err(_) => continue };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) { continue; }

        let path_str = entry.path().to_string_lossy().to_string();

        // If target_paths is provided, only process those files
        if let Some(targets) = target_paths {
            if !targets.iter().any(|t| path_str.ends_with(t)) {
                continue;
            }
        }

        files_to_process.push((path_str, entry.path().to_path_buf()));
    }

    let mut results = Vec::new();
    let mut total_files_replaced = 0u32;
    let mut total_matches_replaced = 0u32;

    for (path_str, file_path) in files_to_process {
        // Read file
        let content = match std::fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(e) => {
                results.push(FileResult {
                    path: path_str,
                    matches_replaced: 0,
                    error: Some(e.to_string()),
                });
                continue;
            }
        };

        // Count matches and perform replacement
        let match_count = re.find_iter(&content).count() as u32;

        if match_count > 0 {
            let new_content = re.replace_all(&content, replacement).to_string();

            // Write back
            if let Err(e) = std::fs::write(&file_path, &new_content) {
                results.push(FileResult {
                    path: path_str,
                    matches_replaced: 0,
                    error: Some(e.to_string()),
                });
                continue;
            }

            results.push(FileResult {
                path: path_str,
                matches_replaced: match_count,
                error: None,
            });
            total_files_replaced += 1;
            total_matches_replaced += match_count;
        } else {
            results.push(FileResult {
                path: path_str,
                matches_replaced: 0,
                error: None,
            });
        }
    }

    Ok(ReplaceResponse {
        results,
        total_files_replaced,
        total_matches_replaced,
    })
}

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

        let lit = find_in_folder(
            &dir, "a.b",
            &FindOptions { regex: false, ..Default::default() },
        ).unwrap();
        assert_eq!(lit.files[0].matches.len(), 1);
        assert_eq!(lit.files[0].matches[0].line_text, "a.b");

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

    #[test]
    fn truncates_at_max_matches() {
        let dir = tmp("cap");
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
        let mut bytes: Vec<u8> = b"foo\nfoo".to_vec();
        bytes.insert(3, 0u8);
        std::fs::write(dir.join("bin.dat"), bytes).unwrap();
        write(&dir, "good.txt", "foo\nfoo\n");

        let resp = find_in_folder(&dir, "foo", &FindOptions::default()).unwrap();
        assert_eq!(resp.files.len(), 1);
        assert!(resp.files[0].path.ends_with("good.txt"));
    }

    #[test]
    fn workspace_missing_returns_error() {
        let missing = std::env::temp_dir().join("memopad_search_does_not_exist_xyz");
        let _ = std::fs::remove_dir_all(&missing);

        let err = find_in_folder(&missing, "foo", &FindOptions::default()).unwrap_err();
        match err {
            FindError::WorkspaceMissing => {}
            other => panic!("expected WorkspaceMissing, got {:?}", other),
        }
    }

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
        assert_eq!(resp.total_files_replaced, 1);
        let b_entry = resp.results.iter().find(|r| r.path.ends_with("b.txt")).unwrap();
        assert_eq!(b_entry.matches_replaced, 0);
        assert_eq!(b_entry.error, None);
        let b_content = std::fs::read_to_string(dir.join("b.txt")).unwrap();
        assert_eq!(b_content, "no match here");
    }
}
