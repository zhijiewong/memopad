// Directory listing for the workspace file tree.
// One Tauri command (`list_dir`) returns the immediate children of a directory
// using `ignore::WalkBuilder` so .gitignore and dotfile filtering match
// find-in-files behavior.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug)]
pub enum FilesError {
    PathMissing,
    NotADirectory,
    Io(std::io::Error),
}

impl std::fmt::Display for FilesError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FilesError::PathMissing => write!(f, "Folder no longer accessible"),
            FilesError::NotADirectory => write!(f, "Path is not a directory"),
            FilesError::Io(e) => write!(f, "{}", e),
        }
    }
}

impl From<std::io::Error> for FilesError {
    fn from(e: std::io::Error) -> Self { FilesError::Io(e) }
}

/// Internal: list the immediate children of `path` (depth=1) honoring
/// .gitignore / .ignore / hidden files. Sorted: dirs first, then files,
/// both alphabetically case-insensitive. The root itself is excluded.
pub fn list_dir(path: &Path) -> Result<Vec<DirEntry>, FilesError> {
    use ignore::WalkBuilder;

    if !path.exists() {
        return Err(FilesError::PathMissing);
    }
    if !path.is_dir() {
        return Err(FilesError::NotADirectory);
    }

    let mut entries: Vec<DirEntry> = Vec::new();
    let walker = WalkBuilder::new(path)
        .standard_filters(true)
        .max_depth(Some(1))
        .require_git(false)
        .build();

    for result in walker {
        let entry = match result { Ok(e) => e, Err(_) => continue };
        if entry.depth() == 0 { continue; }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path().to_string_lossy().to_string();
        entries.push(DirEntry { name, path, is_dir });
    }

    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

/// Public: validate that `path` is under `workspace`, then list it.
pub fn list_dir_under(workspace: &Path, path: &Path) -> Result<Vec<DirEntry>, FilesError> {
    let ws_canon = workspace.canonicalize().map_err(|_| FilesError::PathMissing)?;
    let path_canon = path.canonicalize().map_err(|_| FilesError::PathMissing)?;
    if !path_canon.starts_with(&ws_canon) {
        return Err(FilesError::PathMissing);
    }
    list_dir(&path_canon)
}

pub const MAX_QUICK_OPEN_FILES: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WalkResponse {
    pub files: Vec<String>,
    pub truncated: bool,
    pub elapsed_ms: u64,
}

pub fn walk_files(workspace: &Path) -> Result<WalkResponse, FilesError> {
    use ignore::WalkBuilder;

    if !workspace.exists() {
        return Err(FilesError::PathMissing);
    }
    if !workspace.is_dir() {
        return Err(FilesError::NotADirectory);
    }

    let started = std::time::Instant::now();

    let mut files: Vec<String> = Vec::new();
    let mut walker = WalkBuilder::new(workspace);
    walker.standard_filters(true);
    walker.require_git(false);
    let walker = walker.build();

    let mut truncated = false;
    for entry in walker {
        if files.len() >= MAX_QUICK_OPEN_FILES {
            truncated = true;
            break;
        }
        let entry = match entry { Ok(e) => e, Err(_) => continue };
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            files.push(entry.path().to_string_lossy().to_string());
        }
    }

    files.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));

    Ok(WalkResponse {
        files,
        truncated,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "memopad_files_{}_{}_{}",
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
            std::process::id(),
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch(dir: &std::path::Path, rel: &str) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).unwrap(); }
        std::fs::write(path, b"").unwrap();
    }

    #[test]
    fn lists_files_and_dirs_sorted() {
        let dir = tmp("sorted");
        std::fs::create_dir_all(dir.join("A")).unwrap();
        std::fs::create_dir_all(dir.join("B")).unwrap();
        touch(&dir, "b.txt");
        touch(&dir, "c.rs");

        let entries = list_dir(&dir).unwrap();
        let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
        assert_eq!(names, vec!["A", "B", "b.txt", "c.rs"]);
        assert_eq!(entries[0].is_dir, true);
        assert_eq!(entries[1].is_dir, true);
        assert_eq!(entries[2].is_dir, false);
        assert_eq!(entries[3].is_dir, false);
    }

    #[test]
    fn respects_gitignore() {
        let dir = tmp("ignore");
        std::fs::write(dir.join(".gitignore"), "target/\n").unwrap();
        std::fs::create_dir_all(dir.join("target")).unwrap();
        touch(&dir, "target/build.rs");
        touch(&dir, "src.rs");

        let entries = list_dir(&dir).unwrap();
        let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
        assert!(!names.contains(&"target".to_string()), "expected target/ to be filtered, got {:?}", names);
        assert!(names.contains(&"src.rs".to_string()));
    }

    #[test]
    fn skips_hidden_dotfiles() {
        let dir = tmp("hidden");
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        touch(&dir, ".env");
        touch(&dir, "visible.txt");

        let entries = list_dir(&dir).unwrap();
        let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
        assert!(!names.contains(&".git".to_string()), "expected .git to be hidden");
        assert!(!names.contains(&".env".to_string()), "expected .env to be hidden");
        assert!(names.contains(&"visible.txt".to_string()));
    }

    #[test]
    fn max_depth_is_one() {
        let dir = tmp("depth");
        std::fs::create_dir_all(dir.join("a/b")).unwrap();
        touch(&dir, "a/b/c.txt");

        let entries = list_dir(&dir).unwrap();
        let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
        assert_eq!(names, vec!["a"]);
    }

    #[test]
    fn errors_when_path_missing() {
        let missing = std::env::temp_dir().join("memopad_files_does_not_exist_xyz_abc");
        let _ = std::fs::remove_dir_all(&missing);
        let err = list_dir(&missing).unwrap_err();
        match err { FilesError::PathMissing => {}, other => panic!("expected PathMissing, got {:?}", other) }
    }

    #[test]
    fn errors_when_path_is_file() {
        let dir = tmp("isfile");
        touch(&dir, "a.txt");
        let err = list_dir(&dir.join("a.txt")).unwrap_err();
        match err { FilesError::NotADirectory => {}, other => panic!("expected NotADirectory, got {:?}", other) }
    }

    #[test]
    fn list_dir_under_lists_workspace_itself() {
        let dir = tmp("under_root");
        touch(&dir, "a.txt");
        let entries = list_dir_under(&dir, &dir).unwrap();
        let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
        assert_eq!(names, vec!["a.txt"]);
    }

    #[test]
    fn rejects_path_outside_workspace() {
        let workspace = tmp("ws_in");
        let other = tmp("ws_out");
        let err = list_dir_under(&workspace, &other).unwrap_err();
        match err { FilesError::PathMissing => {}, other => panic!("expected PathMissing, got {:?}", other) }
    }

    #[test]
    fn walk_files_returns_all_files_under_workspace() {
        let dir = tmp("walk_all");
        touch(&dir, "a.txt");
        touch(&dir, "sub/b.rs");
        touch(&dir, "sub/c.json");

        let resp = walk_files(&dir).unwrap();
        let names: Vec<String> = resp.files.iter()
            .map(|p| p.replace('\\', "/"))
            .collect();
        let names_concat = names.join("|");
        assert!(names_concat.contains("a.txt"), "got {:?}", names);
        assert!(names_concat.contains("sub/b.rs"), "got {:?}", names);
        assert!(names_concat.contains("sub/c.json"), "got {:?}", names);
        assert_eq!(resp.files.len(), 3, "expected exactly 3 files, got {:?}", names);
        assert!(!resp.truncated);
    }

    #[test]
    fn walk_files_respects_gitignore() {
        let dir = tmp("walk_ignore");
        std::fs::write(dir.join(".gitignore"), "target/\n").unwrap();
        touch(&dir, "src/main.rs");
        touch(&dir, "target/build.log");

        let resp = walk_files(&dir).unwrap();
        let names_concat: String = resp.files.iter()
            .map(|p| p.replace('\\', "/"))
            .collect::<Vec<_>>()
            .join("|");
        assert!(names_concat.contains("src/main.rs"), "got {:?}", resp.files);
        assert!(!names_concat.contains("target/build.log"), "target/ should be filtered, got {:?}", resp.files);
    }

    #[test]
    fn walk_files_caps_at_max_quick_open_files() {
        let dir = tmp("walk_cap");
        for i in 0..10_050 {
            std::fs::write(dir.join(format!("f{}.txt", i)), b"").unwrap();
        }
        let resp = walk_files(&dir).unwrap();
        assert!(resp.files.len() <= MAX_QUICK_OPEN_FILES, "got {} files, cap is {}", resp.files.len(), MAX_QUICK_OPEN_FILES);
        assert!(resp.truncated, "expected truncated flag when above cap");
    }
}
