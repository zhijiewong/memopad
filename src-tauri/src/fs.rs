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

/// Detects the dominant line ending in a string.
/// Tie-break order: CRLF > LF > CR. If none found, defaults to platform default (LF).
pub fn detect_line_ending(text: &str) -> LineEnding {
    let crlf = text.matches("\r\n").count();
    let bytes = text.as_bytes();
    let total_lf = bytes.iter().filter(|&&b| b == b'\n').count();
    let total_cr = bytes.iter().filter(|&&b| b == b'\r').count();
    let bare_lf = total_lf.saturating_sub(crlf);
    let bare_cr = total_cr.saturating_sub(crlf);

    if crlf > 0 && crlf >= bare_lf && crlf >= bare_cr {
        LineEnding::Crlf
    } else if bare_lf >= bare_cr {
        // Includes "no endings found" — fall through to LF as the platform-neutral default.
        LineEnding::Lf
    } else {
        LineEnding::Cr
    }
}

#[cfg(test)]
mod eol_tests {
    use super::*;

    #[test]
    fn detects_crlf() {
        assert_eq!(detect_line_ending("a\r\nb\r\nc"), LineEnding::Crlf);
    }

    #[test]
    fn detects_lf() {
        assert_eq!(detect_line_ending("a\nb\nc"), LineEnding::Lf);
    }

    #[test]
    fn detects_cr() {
        assert_eq!(detect_line_ending("a\rb\rc"), LineEnding::Cr);
    }

    #[test]
    fn empty_defaults_to_lf() {
        assert_eq!(detect_line_ending(""), LineEnding::Lf);
    }

    #[test]
    fn no_endings_defaults_to_lf() {
        assert_eq!(detect_line_ending("one line no endings"), LineEnding::Lf);
    }

    #[test]
    fn mixed_picks_majority_crlf_over_lf() {
        // CRLF (3) appears more often than a bare LF (1).
        // Note: each CRLF also contains an LF; the function must not double-count.
        assert_eq!(detect_line_ending("a\r\nb\r\nc\r\nd\ne"), LineEnding::Crlf);
    }
}

/// Decode file bytes to a Rust String according to the detected encoding.
/// Strips the BOM if present. Falls back to `replacement_character` for any
/// invalid byte sequence (lossy decode, never panics).
pub fn decode_bytes(bytes: &[u8], encoding: Encoding) -> String {
    use encoding_rs::{UTF_16BE, UTF_16LE, UTF_8};
    let enc = match encoding {
        Encoding::Utf8 | Encoding::Utf8Bom => UTF_8,
        Encoding::Utf16Le => UTF_16LE,
        Encoding::Utf16Be => UTF_16BE,
    };
    // `decode` strips BOM if present and substitutes U+FFFD on errors.
    let (text, _enc_used, _had_errors) = enc.decode(bytes);
    text.into_owned()
}

#[cfg(test)]
mod decode_tests {
    use super::*;

    #[test]
    fn decodes_plain_utf8() {
        let bytes = "hello".as_bytes();
        assert_eq!(decode_bytes(bytes, Encoding::Utf8), "hello");
    }

    #[test]
    fn decodes_utf8_bom_strips_bom() {
        let bytes = b"\xEF\xBB\xBFhi";
        assert_eq!(decode_bytes(bytes, Encoding::Utf8Bom), "hi");
    }

    #[test]
    fn decodes_utf16_le_bom() {
        // "hi" in UTF-16 LE with BOM
        let bytes = b"\xFF\xFEh\x00i\x00";
        assert_eq!(decode_bytes(bytes, Encoding::Utf16Le), "hi");
    }

    #[test]
    fn decodes_utf16_be_bom() {
        // "hi" in UTF-16 BE with BOM
        let bytes = b"\xFE\xFF\x00h\x00i";
        assert_eq!(decode_bytes(bytes, Encoding::Utf16Be), "hi");
    }

    #[test]
    fn invalid_utf8_replaced_not_panic() {
        let bytes = b"valid\xFFinvalid";
        let out = decode_bytes(bytes, Encoding::Utf8);
        assert!(out.contains("valid"));
        assert!(out.contains('\u{FFFD}')); // replacement char
    }
}

/// Encode a String back to bytes for writing to disk.
/// Re-emits the BOM for UTF-8 BOM, UTF-16 LE, and UTF-16 BE.
pub fn encode_string(text: &str, encoding: Encoding) -> Vec<u8> {
    match encoding {
        Encoding::Utf8 => text.as_bytes().to_vec(),
        Encoding::Utf8Bom => {
            let mut out = Vec::with_capacity(text.len() + 3);
            out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            out.extend_from_slice(text.as_bytes());
            out
        }
        Encoding::Utf16Le => {
            let mut out: Vec<u8> = vec![0xFF, 0xFE];
            for code_unit in text.encode_utf16() {
                out.extend_from_slice(&code_unit.to_le_bytes());
            }
            out
        }
        Encoding::Utf16Be => {
            let mut out: Vec<u8> = vec![0xFE, 0xFF];
            for code_unit in text.encode_utf16() {
                out.extend_from_slice(&code_unit.to_be_bytes());
            }
            out
        }
    }
}

#[cfg(test)]
mod encode_tests {
    use super::*;

    #[test]
    fn encodes_plain_utf8_no_bom() {
        let bytes = encode_string("hi", Encoding::Utf8);
        assert_eq!(bytes, b"hi");
    }

    #[test]
    fn encodes_utf8_bom_prepends_bom() {
        let bytes = encode_string("hi", Encoding::Utf8Bom);
        assert_eq!(bytes, b"\xEF\xBB\xBFhi");
    }

    #[test]
    fn encodes_utf16_le_with_bom() {
        let bytes = encode_string("hi", Encoding::Utf16Le);
        assert_eq!(bytes, b"\xFF\xFEh\x00i\x00");
    }

    #[test]
    fn encodes_utf16_be_with_bom() {
        let bytes = encode_string("hi", Encoding::Utf16Be);
        assert_eq!(bytes, b"\xFE\xFF\x00h\x00i");
    }
}
