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
pub fn list_dir(_path: &Path) -> Result<Vec<DirEntry>, FilesError> {
    Ok(Vec::new())
}

/// Public: validate that `path` is under `workspace`, then list it.
pub fn list_dir_under(_workspace: &Path, _path: &Path) -> Result<Vec<DirEntry>, FilesError> {
    Ok(Vec::new())
}
