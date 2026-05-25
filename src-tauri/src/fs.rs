// File I/O: opening, saving, encoding/EOL detection.
// All filesystem access in Memopad goes through this module.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Encoding {
    // Explicit renames produce canonical IANA-style charset labels on the wire
    // (utf-8, utf-16-le, ...) — kebab-case alone would emit "utf8" because
    // PascalCase `Utf8` has no internal word boundary.
    #[serde(rename = "utf-8")]
    Utf8,
    #[serde(rename = "utf-8-bom")]
    Utf8Bom,
    #[serde(rename = "utf-16-le")]
    Utf16Le,
    #[serde(rename = "utf-16-be")]
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

#[tauri::command]
pub fn open_file(path: String) -> Result<OpenedFile, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("read {}: {}", path, e))?;
    let (encoding, _bom_offset) = detect_encoding(&bytes);
    let content = decode_bytes(&bytes, encoding);
    let eol = detect_line_ending(&content);
    Ok(OpenedFile {
        path,
        content,
        encoding,
        eol,
    })
}

#[cfg(test)]
mod open_file_tests {
    use super::*;
    use std::io::Write;

    fn write_tmp(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("memopad_test_open");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(bytes).unwrap();
        path
    }

    #[test]
    fn opens_utf8_lf_file() {
        let path = write_tmp("utf8_lf.txt", b"hello\nworld\n");
        let opened = open_file(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(opened.content, "hello\nworld\n");
        assert_eq!(opened.encoding, Encoding::Utf8);
        assert_eq!(opened.eol, LineEnding::Lf);
    }

    #[test]
    fn opens_utf8_crlf_file() {
        let path = write_tmp("utf8_crlf.txt", b"hello\r\nworld\r\n");
        let opened = open_file(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(opened.content, "hello\r\nworld\r\n");
        assert_eq!(opened.encoding, Encoding::Utf8);
        assert_eq!(opened.eol, LineEnding::Crlf);
    }

    #[test]
    fn opens_utf16_le_bom_file() {
        // "hi\n" in UTF-16 LE with BOM
        let path = write_tmp(
            "utf16le.txt",
            b"\xFF\xFEh\x00i\x00\n\x00",
        );
        let opened = open_file(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(opened.content, "hi\n");
        assert_eq!(opened.encoding, Encoding::Utf16Le);
        assert_eq!(opened.eol, LineEnding::Lf);
    }

    #[test]
    fn missing_file_returns_error() {
        let result = open_file("Z:\\does\\not\\exist.txt".to_string());
        assert!(result.is_err());
    }
}

#[tauri::command]
pub fn save_file(
    path: String,
    content: String,
    encoding: Encoding,
    eol: LineEnding,
) -> Result<(), String> {
    let _ = eol; // EOL of the file is determined by the bytes in `content` itself;
                 // callers normalize line endings in the buffer before calling.
                 // We accept the parameter for symmetry with `open_file` and future use.
    use std::io::Write;

    let bytes = encode_string(&content, encoding);
    let target = std::path::PathBuf::from(&path);
    let tmp = {
        let mut t = target.clone();
        let mut new_name = target
            .file_name()
            .ok_or_else(|| format!("invalid path: {}", path))?
            .to_os_string();
        new_name.push(".tmp");
        t.set_file_name(new_name);
        t
    };

    {
        let mut f = std::fs::File::create(&tmp)
            .map_err(|e| format!("create tmp {}: {}", tmp.display(), e))?;
        f.write_all(&bytes)
            .map_err(|e| format!("write tmp: {}", e))?;
        f.sync_all()
            .map_err(|e| format!("fsync tmp: {}", e))?;
    }

    std::fs::rename(&tmp, &target)
        .map_err(|e| format!("rename {} -> {}: {}", tmp.display(), target.display(), e))?;
    Ok(())
}

#[cfg(test)]
mod save_file_tests {
    use super::*;

    fn tmp_path(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("memopad_test_save");
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn saves_utf8_no_bom() {
        let path = tmp_path("out_utf8.txt");
        let _ = std::fs::remove_file(&path);
        save_file(
            path.to_string_lossy().to_string(),
            "hello\n".to_string(),
            Encoding::Utf8,
            LineEnding::Lf,
        )
        .unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(bytes, b"hello\n");
    }

    #[test]
    fn saves_utf16_le_with_bom() {
        let path = tmp_path("out_utf16le.txt");
        let _ = std::fs::remove_file(&path);
        save_file(
            path.to_string_lossy().to_string(),
            "hi".to_string(),
            Encoding::Utf16Le,
            LineEnding::Lf,
        )
        .unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(bytes, b"\xFF\xFEh\x00i\x00");
    }

    #[test]
    fn save_does_not_leave_tmp_file_behind() {
        let path = tmp_path("out_clean.txt");
        let tmp = path.with_extension("txt.tmp");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&tmp);
        save_file(
            path.to_string_lossy().to_string(),
            "x".to_string(),
            Encoding::Utf8,
            LineEnding::Lf,
        )
        .unwrap();
        assert!(path.exists(), "final file should exist");
        assert!(!tmp.exists(), "temp file should have been renamed away");
    }

    #[test]
    fn save_overwrites_existing_file() {
        let path = tmp_path("out_overwrite.txt");
        std::fs::write(&path, b"old contents").unwrap();
        save_file(
            path.to_string_lossy().to_string(),
            "new".to_string(),
            Encoding::Utf8,
            LineEnding::Lf,
        )
        .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
    }
}

#[cfg(test)]
mod roundtrip_tests {
    use super::*;

    /// Spec acceptance #3: open a UTF-16 LE BOM file, edit, save -> bytes preserved.
    #[test]
    fn utf16_le_bom_roundtrip_preserves_bom_and_encoding() {
        let dir = std::env::temp_dir().join("memopad_test_roundtrip");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rt.txt");

        // Original bytes: BOM + "hello\n" in UTF-16 LE
        let original: Vec<u8> = {
            let mut v: Vec<u8> = vec![0xFF, 0xFE];
            for u in "hello\n".encode_utf16() {
                v.extend_from_slice(&u.to_le_bytes());
            }
            v
        };
        std::fs::write(&path, &original).unwrap();

        let opened = open_file(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(opened.encoding, Encoding::Utf16Le);
        assert_eq!(opened.content, "hello\n");

        // Edit the content
        let edited = opened.content + "world\n";

        save_file(
            path.to_string_lossy().to_string(),
            edited.clone(),
            opened.encoding,
            opened.eol,
        )
        .unwrap();

        let after = std::fs::read(&path).unwrap();
        // BOM still present
        assert_eq!(&after[..2], &[0xFF, 0xFE]);
        // Re-decoding gives back the edited content
        let reopened = open_file(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(reopened.content, edited);
        assert_eq!(reopened.encoding, Encoding::Utf16Le);
    }
}
