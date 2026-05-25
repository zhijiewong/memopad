// File I/O: opening, saving, encoding/EOL detection.
// All filesystem access in Memopad goes through this module.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Encoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LineEnding {
    Lf,
    Crlf,
    Cr,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenedFile {
    pub path: String,
    pub content: String,
    pub encoding: Encoding,
    pub eol: LineEnding,
}
