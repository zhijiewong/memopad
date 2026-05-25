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

/// Detects the encoding of a file from its leading bytes.
/// Returns the encoding *and* the byte offset where actual content begins
/// (past any BOM).
pub fn detect_encoding(bytes: &[u8]) -> (Encoding, usize) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        (Encoding::Utf8Bom, 3)
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        (Encoding::Utf16Le, 2)
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        (Encoding::Utf16Be, 2)
    } else {
        (Encoding::Utf8, 0)
    }
}

#[cfg(test)]
mod encoding_tests {
    use super::*;

    #[test]
    fn detects_utf8_bom() {
        let bytes = b"\xEF\xBB\xBFhello";
        let (enc, offset) = detect_encoding(bytes);
        assert_eq!(enc, Encoding::Utf8Bom);
        assert_eq!(offset, 3);
    }

    #[test]
    fn detects_utf16_le_bom() {
        let bytes = b"\xFF\xFEh\x00i\x00";
        let (enc, offset) = detect_encoding(bytes);
        assert_eq!(enc, Encoding::Utf16Le);
        assert_eq!(offset, 2);
    }

    #[test]
    fn detects_utf16_be_bom() {
        let bytes = b"\xFE\xFF\x00h\x00i";
        let (enc, offset) = detect_encoding(bytes);
        assert_eq!(enc, Encoding::Utf16Be);
        assert_eq!(offset, 2);
    }

    #[test]
    fn defaults_to_utf8_with_no_bom() {
        let bytes = b"hello world";
        let (enc, offset) = detect_encoding(bytes);
        assert_eq!(enc, Encoding::Utf8);
        assert_eq!(offset, 0);
    }

    #[test]
    fn empty_input_defaults_to_utf8() {
        let (enc, offset) = detect_encoding(b"");
        assert_eq!(enc, Encoding::Utf8);
        assert_eq!(offset, 0);
    }
}
