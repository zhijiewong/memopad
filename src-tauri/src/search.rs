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
