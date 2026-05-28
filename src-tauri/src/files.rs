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
}
