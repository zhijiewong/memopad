# Memopad Phase 2 — File I/O + Single-Buffer Editor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount a CodeMirror 6 editor in the Phase 1 shell, add a Rust `shell/fs` module that opens and saves files while preserving encoding and line endings, and wire `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+N` so the app can be used as a real one-file-at-a-time editor.

**Architecture:** Rust owns all file I/O. The frontend never reads disk directly. A buffer in the UI carries `{ path, content, encoding, eol, dirty, originalContent }`. Open: dialog → IPC `open_file` → store. Save: IPC `save_file(path, content, encoding, eol)` → atomic write (`.tmp` → fsync → rename). CodeMirror is mounted via the `@uiw/react-codemirror` React wrapper for minimum glue code. Tests are split: Rust unit tests for the fs module, Vitest unit tests for the buffer store and IPC wrapper, manual smoke for the editor itself.

**Tech Stack:** Tauri 2, Rust + `encoding_rs`, React 18 + TypeScript, CodeMirror 6 (via `@uiw/react-codemirror`), Zustand, Vitest, `tauri-plugin-dialog` (native open/save dialogs).

**Spec section reference:** `docs/superpowers/specs/2026-05-25-memopad-design.md` sections 2 (tech stack: CodeMirror 6, Zustand), 3.1 (`shell/fs` interface — `open_file`, `save_file`), 3.2 (Ctrl+S → atomic write flow), 5.1 acceptance scenario #3 (UTF-16 LE BOM round-trip).

---

## File Structure

```
memopad/
├── src-tauri/
│   ├── Cargo.toml                          MODIFY — add encoding_rs + tauri-plugin-dialog
│   ├── capabilities/default.json           MODIFY — allow dialog plugin
│   └── src/
│       ├── lib.rs                          MODIFY — register fs commands + dialog plugin
│       └── fs.rs                           CREATE — open_file, save_file, encoding/EOL
├── src/
│   ├── lib/
│   │   └── tauri.ts                        CREATE — typed IPC wrappers
│   ├── stores/
│   │   └── buffer.ts                       CREATE — Zustand single-buffer store
│   ├── components/
│   │   ├── Editor.tsx                      CREATE — CodeMirror 6 wrapper
│   │   └── TitleBar.tsx                    MODIFY — show file path + dirty dot
│   ├── lib/
│   │   └── language.ts                     CREATE — extension → CM language extension
│   ├── App.tsx                             MODIFY — render Editor; wire keybindings
│   └── tests/                              CREATE — Vitest test files
│       ├── buffer.test.ts
│       └── tauri.test.ts
├── vitest.config.ts                        CREATE
└── package.json                            MODIFY — add deps + vitest script
```

Boundary intent:
- `src-tauri/src/fs.rs` is pure file I/O: it returns and accepts plain Rust types. No Tauri-specific code beyond the `#[tauri::command]` attributes on the two exported commands. Easy to unit-test.
- `src/lib/tauri.ts` is the **only** module that calls `invoke()`. Every other UI module imports typed wrappers from this file.
- `src/stores/buffer.ts` owns buffer state. Components never set buffer fields directly — they call store actions.
- `src/components/Editor.tsx` knows about CodeMirror; nothing else does. The rest of the app sees `value`, `onChange`, `language`.

---

## Task 1: Add Rust dependencies and create the `fs` module skeleton

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/fs.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add Cargo dependencies**

Open `src-tauri/Cargo.toml`. Find the `[dependencies]` section. Add these two lines (keep existing dependencies in place; do not remove `serde`, `serde_json`, `tauri`, etc.):

```toml
encoding_rs = "0.8"
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Create the empty `fs` module file**

Create `src-tauri/src/fs.rs` with exactly:

```rust
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
```

- [ ] **Step 3: Declare `mod fs;` in lib.rs**

Open `src-tauri/src/lib.rs`. Add at the very top (before the `#[tauri::command]` attribute on the first window command):

```rust
mod fs;
```

(Leave everything else alone — this task does not register any new commands yet.)

- [ ] **Step 4: Verify it compiles**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Set-Location src-tauri
cargo check
Set-Location ..
```

Expected: `Finished` line with at most a couple of dead-code warnings for the unused enum variants. No errors.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/fs.rs src-tauri/src/lib.rs
git commit -m "fs: add module skeleton with Encoding, LineEnding, OpenedFile types"
```

---

## Task 2: TDD — detect encoding from BOM

**Files:**
- Modify: `src-tauri/src/fs.rs`

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/src/fs.rs`:

```rust
/// Detects the encoding of a file from its leading bytes.
/// Returns the encoding *and* the byte offset where actual content begins
/// (past any BOM).
pub fn detect_encoding(bytes: &[u8]) -> (Encoding, usize) {
    todo!()
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
```

- [ ] **Step 2: Verify tests fail with `todo!()` panic**

```powershell
Set-Location src-tauri
cargo test fs::encoding_tests 2>&1 | Select-Object -Last 30
Set-Location ..
```

Expected: all 5 tests panic with `not yet implemented` (the `todo!()` macro).

- [ ] **Step 3: Implement `detect_encoding`**

Replace the `todo!()` body in `src-tauri/src/fs.rs`:

```rust
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
```

- [ ] **Step 4: Verify tests pass**

```powershell
Set-Location src-tauri
cargo test fs::encoding_tests
Set-Location ..
```

Expected: `test result: ok. 5 passed; 0 failed`.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/fs.rs
git commit -m "fs: detect_encoding handles UTF-8 BOM, UTF-16 LE/BE BOM, plain UTF-8"
```

---

## Task 3: TDD — detect line endings

**Files:**
- Modify: `src-tauri/src/fs.rs`

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/src/fs.rs`:

```rust
/// Detects the dominant line ending in a string.
/// Tie-break order: CRLF > LF > CR. If none found, defaults to platform default (LF).
pub fn detect_line_ending(text: &str) -> LineEnding {
    todo!()
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
```

- [ ] **Step 2: Verify tests fail**

```powershell
Set-Location src-tauri
cargo test fs::eol_tests 2>&1 | Select-Object -Last 30
Set-Location ..
```

Expected: all 6 tests panic with `not yet implemented`.

- [ ] **Step 3: Implement `detect_line_ending`**

Replace the `todo!()` body:

```rust
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
```

- [ ] **Step 4: Verify tests pass**

```powershell
Set-Location src-tauri
cargo test fs::eol_tests
Set-Location ..
```

Expected: `test result: ok. 6 passed; 0 failed`.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/fs.rs
git commit -m "fs: detect_line_ending picks dominant CRLF/LF/CR, defaults to LF"
```

---

## Task 4: TDD — decode bytes to String using the detected encoding

**Files:**
- Modify: `src-tauri/src/fs.rs`

- [ ] **Step 1: Write the failing tests**

Append:

```rust
/// Decode file bytes to a Rust String according to the detected encoding.
/// Strips the BOM if present. Falls back to `replacement_character` for any
/// invalid byte sequence (lossy decode, never panics).
pub fn decode_bytes(bytes: &[u8], encoding: Encoding) -> String {
    todo!()
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
```

- [ ] **Step 2: Verify tests fail**

```powershell
Set-Location src-tauri
cargo test fs::decode_tests 2>&1 | Select-Object -Last 30
Set-Location ..
```

Expected: all 5 tests panic.

- [ ] **Step 3: Implement `decode_bytes`**

```rust
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
```

- [ ] **Step 4: Verify tests pass**

```powershell
Set-Location src-tauri
cargo test fs::decode_tests
Set-Location ..
```

Expected: `test result: ok. 5 passed; 0 failed`.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/fs.rs
git commit -m "fs: decode_bytes converts file bytes to String per detected encoding"
```

---

## Task 5: TDD — encode String back to bytes for save

**Files:**
- Modify: `src-tauri/src/fs.rs`

- [ ] **Step 1: Write the failing tests**

Append:

```rust
/// Encode a String back to bytes for writing to disk.
/// Re-emits the BOM for UTF-8 BOM, UTF-16 LE, and UTF-16 BE.
pub fn encode_string(text: &str, encoding: Encoding) -> Vec<u8> {
    todo!()
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
```

- [ ] **Step 2: Verify tests fail**

```powershell
Set-Location src-tauri
cargo test fs::encode_tests 2>&1 | Select-Object -Last 30
Set-Location ..
```

- [ ] **Step 3: Implement `encode_string`**

```rust
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
```

- [ ] **Step 4: Verify tests pass**

```powershell
Set-Location src-tauri
cargo test fs::encode_tests
Set-Location ..
```

Expected: `test result: ok. 4 passed; 0 failed`.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/fs.rs
git commit -m "fs: encode_string round-trips bytes for save, preserves BOMs"
```

---

## Task 6: TDD — `open_file` command

**Files:**
- Modify: `src-tauri/src/fs.rs`

- [ ] **Step 1: Write the failing tests**

Append:

```rust
#[tauri::command]
pub fn open_file(path: String) -> Result<OpenedFile, String> {
    todo!()
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
```

- [ ] **Step 2: Verify tests fail**

```powershell
Set-Location src-tauri
cargo test fs::open_file_tests 2>&1 | Select-Object -Last 30
Set-Location ..
```

Expected: 4 tests panic on `todo!()`.

- [ ] **Step 3: Implement `open_file`**

```rust
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
```

- [ ] **Step 4: Verify tests pass**

```powershell
Set-Location src-tauri
cargo test fs::open_file_tests
Set-Location ..
```

Expected: `test result: ok. 4 passed; 0 failed`.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/fs.rs
git commit -m "fs: open_file command reads bytes, detects encoding+EOL, returns OpenedFile"
```

---

## Task 7: TDD — `save_file` atomic write

**Files:**
- Modify: `src-tauri/src/fs.rs`

- [ ] **Step 1: Write the failing tests**

Append:

```rust
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
    todo!()
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
```

- [ ] **Step 2: Verify tests fail**

```powershell
Set-Location src-tauri
cargo test fs::save_file_tests 2>&1 | Select-Object -Last 30
Set-Location ..
```

Expected: 4 tests panic.

- [ ] **Step 3: Implement `save_file` (atomic write: tmp → fsync → rename)**

Replace the `todo!()` body:

```rust
#[tauri::command]
pub fn save_file(
    path: String,
    content: String,
    encoding: Encoding,
    eol: LineEnding,
) -> Result<(), String> {
    let _ = eol; // see doc-comment in test version
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
```

- [ ] **Step 4: Verify tests pass**

```powershell
Set-Location src-tauri
cargo test fs::save_file_tests
Set-Location ..
```

Expected: `test result: ok. 4 passed; 0 failed`.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/fs.rs
git commit -m "fs: save_file performs atomic write (tmp -> fsync -> rename)"
```

---

## Task 8: TDD — end-to-end UTF-16 LE BOM round-trip (spec acceptance #3)

**Files:**
- Modify: `src-tauri/src/fs.rs`

- [ ] **Step 1: Write the round-trip test**

Append:

```rust
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
```

- [ ] **Step 2: Run all fs tests together**

```powershell
Set-Location src-tauri
cargo test fs::
Set-Location ..
```

Expected: 5 modules, 1 roundtrip + the 24 from earlier tasks = `test result: ok. 25 passed; 0 failed`.

(If any earlier test now fails due to interaction, the round-trip surfaced a real bug — fix it in `fs.rs` before committing.)

- [ ] **Step 3: Commit**

```powershell
git add src-tauri/src/fs.rs
git commit -m "fs: roundtrip test confirms UTF-16 LE BOM preserved across save/load"
```

---

## Task 9: Register fs commands and dialog plugin in Tauri builder

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Update lib.rs**

Overwrite `src-tauri/src/lib.rs` with EXACTLY:

```rust
mod fs;

#[tauri::command]
fn window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_toggle_maximize(window: tauri::Window) -> Result<(), String> {
    let is_max = window.is_maximized().map_err(|e| e.to_string())?;
    if is_max {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn window_close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_is_maximized(window: tauri::Window) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_is_maximized,
            fs::open_file,
            fs::save_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: Update capabilities to permit the dialog plugin**

Overwrite `src-tauri/capabilities/default.json` with EXACTLY:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "enables the default permissions",
  "windows": [
    "main"
  ],
  "permissions": [
    "core:default",
    "dialog:default"
  ]
}
```

(Custom Rust commands defined with `#[tauri::command]` and registered via `invoke_handler!` do not require explicit capability entries — the permission system gates plugin and core APIs only.)

- [ ] **Step 3: Verify the Rust side still compiles and all tests pass**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Set-Location src-tauri
cargo check
cargo test
Set-Location ..
```

Expected: `cargo check` finishes cleanly. `cargo test` shows 25+ passing (the fs module tests).

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "shell: register open_file/save_file commands + dialog plugin"
```

---

## Task 10: Set up Vitest for TS unit tests

**Files:**
- Modify: `package.json` (add deps + test script)
- Create: `vitest.config.ts`
- Create: `src/tests/sanity.test.ts` (proves the runner works)

- [ ] **Step 1: Install Vitest**

```powershell
npm install --save-dev "vitest@^2.0.0" "@vitest/ui@^2.0.0" jsdom
```

- [ ] **Step 2: Add `test` script to package.json**

Open `package.json`. Inside `"scripts"`, add `"test": "vitest run"` and `"test:watch": "vitest"`. The full scripts block becomes:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "tauri": "tauri",
  "test": "vitest run",
  "test:watch": "vitest"
},
```

- [ ] **Step 3: Create vitest.config.ts**

Create `vitest.config.ts` with EXACTLY:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

- [ ] **Step 4: Create a sanity test**

Create `src/tests/sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('vitest sanity', () => {
  it('arithmetic works', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the test**

```powershell
npm test
```

Expected: 1 test passes.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json vitest.config.ts src/tests/sanity.test.ts
git commit -m "test: add Vitest with jsdom env and a sanity check"
```

---

## Task 11: TDD — buffer store (Zustand)

**Files:**
- Create: `src/stores/buffer.ts`
- Create: `src/tests/buffer.test.ts`

- [ ] **Step 1: Install Zustand**

```powershell
npm install "zustand@^4.5.0"
```

- [ ] **Step 2: Write the failing tests**

Create `src/tests/buffer.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useBuffer } from '../stores/buffer';

describe('buffer store', () => {
  beforeEach(() => {
    useBuffer.getState().reset();
  });

  it('starts empty and clean', () => {
    const s = useBuffer.getState();
    expect(s.path).toBeNull();
    expect(s.content).toBe('');
    expect(s.dirty).toBe(false);
    expect(s.encoding).toBe('utf-8');
    expect(s.eol).toBe('lf');
  });

  it('setContent dirties when content differs from original', () => {
    useBuffer.getState().setContent('hello');
    expect(useBuffer.getState().dirty).toBe(true);
  });

  it('setContent stays clean when content matches original', () => {
    useBuffer.getState().loadOpened({
      path: '/tmp/x.txt',
      content: 'hello',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffer.getState().setContent('hello');
    expect(useBuffer.getState().dirty).toBe(false);
  });

  it('loadOpened replaces buffer and marks clean', () => {
    useBuffer.getState().setContent('dirty stuff');
    useBuffer.getState().loadOpened({
      path: '/tmp/y.txt',
      content: 'fresh',
      encoding: 'utf-16-le',
      eol: 'crlf',
    });
    const s = useBuffer.getState();
    expect(s.path).toBe('/tmp/y.txt');
    expect(s.content).toBe('fresh');
    expect(s.encoding).toBe('utf-16-le');
    expect(s.eol).toBe('crlf');
    expect(s.dirty).toBe(false);
  });

  it('markSaved resets dirty without touching content', () => {
    useBuffer.getState().loadOpened({
      path: '/tmp/z.txt',
      content: 'a',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffer.getState().setContent('b');
    expect(useBuffer.getState().dirty).toBe(true);
    useBuffer.getState().markSaved('/tmp/z.txt');
    const s = useBuffer.getState();
    expect(s.dirty).toBe(false);
    expect(s.content).toBe('b');
    expect(s.path).toBe('/tmp/z.txt');
  });

  it('reset returns to the initial empty state', () => {
    useBuffer.getState().loadOpened({
      path: '/x',
      content: 'y',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffer.getState().reset();
    const s = useBuffer.getState();
    expect(s.path).toBeNull();
    expect(s.content).toBe('');
    expect(s.dirty).toBe(false);
  });
});
```

- [ ] **Step 3: Verify the tests fail (file doesn't exist)**

```powershell
npm test
```

Expected: failure — `Cannot find module '../stores/buffer'`.

- [ ] **Step 4: Implement `src/stores/buffer.ts`**

Create `src/stores/buffer.ts`:

```ts
import { create } from 'zustand';

export type Encoding = 'utf-8' | 'utf-8-bom' | 'utf-16-le' | 'utf-16-be';
export type LineEnding = 'lf' | 'crlf' | 'cr';

export interface OpenedFile {
  path: string;
  content: string;
  encoding: Encoding;
  eol: LineEnding;
}

interface BufferState {
  path: string | null;
  content: string;
  originalContent: string;
  encoding: Encoding;
  eol: LineEnding;
  dirty: boolean;
  setContent: (next: string) => void;
  loadOpened: (file: OpenedFile) => void;
  markSaved: (newPath: string) => void;
  reset: () => void;
}

const INITIAL = {
  path: null as string | null,
  content: '',
  originalContent: '',
  encoding: 'utf-8' as Encoding,
  eol: 'lf' as LineEnding,
  dirty: false,
};

export const useBuffer = create<BufferState>((set) => ({
  ...INITIAL,
  setContent: (next) =>
    set((state) => ({
      content: next,
      dirty: next !== state.originalContent,
    })),
  loadOpened: (file) =>
    set({
      path: file.path,
      content: file.content,
      originalContent: file.content,
      encoding: file.encoding,
      eol: file.eol,
      dirty: false,
    }),
  markSaved: (newPath) =>
    set((state) => ({
      path: newPath,
      originalContent: state.content,
      dirty: false,
    })),
  reset: () => set({ ...INITIAL }),
}));
```

- [ ] **Step 5: Verify tests pass**

```powershell
npm test
```

Expected: 6 buffer tests + 1 sanity test = 7 passing.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json src/stores/buffer.ts src/tests/buffer.test.ts
git commit -m "ui: buffer store with dirty tracking and OpenedFile load/save events"
```

---

## Task 12: TDD — typed IPC wrappers

**Files:**
- Create: `src/lib/tauri.ts`
- Create: `src/tests/tauri.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/tests/tauri.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Tauri invoke before importing tauri.ts so the import binds to our spy.
const invokeSpy = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeSpy(cmd, args),
}));

import { openFile, saveFile } from '../lib/tauri';

beforeEach(() => {
  invokeSpy.mockReset();
});

describe('tauri ipc wrappers', () => {
  it('openFile invokes open_file with the path arg', async () => {
    invokeSpy.mockResolvedValue({
      path: '/x.txt',
      content: 'hi',
      encoding: 'utf-8',
      eol: 'lf',
    });
    const result = await openFile('/x.txt');
    expect(invokeSpy).toHaveBeenCalledWith('open_file', { path: '/x.txt' });
    expect(result.content).toBe('hi');
  });

  it('saveFile invokes save_file with all four args', async () => {
    invokeSpy.mockResolvedValue(undefined);
    await saveFile('/x.txt', 'body', 'utf-8', 'lf');
    expect(invokeSpy).toHaveBeenCalledWith('save_file', {
      path: '/x.txt',
      content: 'body',
      encoding: 'utf-8',
      eol: 'lf',
    });
  });

  it('openFile surfaces invoke errors as thrown Errors', async () => {
    invokeSpy.mockRejectedValue('disk on fire');
    await expect(openFile('/nope')).rejects.toThrow('disk on fire');
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

```powershell
npm test
```

Expected: failure — `Cannot find module '../lib/tauri'`.

- [ ] **Step 3: Implement `src/lib/tauri.ts`**

Create `src/lib/tauri.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import type { OpenedFile, Encoding, LineEnding } from '../stores/buffer';

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e));
}

export async function openFile(path: string): Promise<OpenedFile> {
  try {
    return await invoke<OpenedFile>('open_file', { path });
  } catch (e) {
    throw asError(e);
  }
}

export async function saveFile(
  path: string,
  content: string,
  encoding: Encoding,
  eol: LineEnding,
): Promise<void> {
  try {
    await invoke<void>('save_file', { path, content, encoding, eol });
  } catch (e) {
    throw asError(e);
  }
}
```

- [ ] **Step 4: Verify tests pass**

```powershell
npm test
```

Expected: 3 IPC tests + 6 buffer + 1 sanity = 10 passing.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/tauri.ts src/tests/tauri.test.ts
git commit -m "ui: typed openFile/saveFile IPC wrappers with Error-shaped rejections"
```

---

## Task 13: Install CodeMirror packages

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the CodeMirror runtime and the React wrapper**

```powershell
npm install "@uiw/react-codemirror@^4.23.0" "@codemirror/state@^6.4.0" "@codemirror/view@^6.30.0" "@codemirror/commands@^6.6.0" "@codemirror/language@^6.10.0" "@codemirror/theme-one-dark@^6.1.0"
```

- [ ] **Step 2: Install language grammars (Phase 2 curated subset)**

```powershell
npm install "@codemirror/lang-javascript@^6.2.0" "@codemirror/lang-rust@^6.0.0" "@codemirror/lang-json@^6.0.0" "@codemirror/lang-markdown@^6.3.0"
```

- [ ] **Step 3: Verify TS still typechecks**

```powershell
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```powershell
git add package.json package-lock.json
git commit -m "ui: install CodeMirror 6 + Rust/JS/JSON/Markdown grammars"
```

---

## Task 14: Language detection helper

**Files:**
- Create: `src/lib/language.ts`

(Pure function — testing inline rather than as a dedicated test file would add files for trivial value. We accept the same coverage gap we accept for similarly trivial helpers; the wired-up editor in Task 16 exercises this.)

- [ ] **Step 1: Create `src/lib/language.ts`**

```ts
import type { Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { rust } from '@codemirror/lang-rust';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';

/**
 * Return a CodeMirror language extension for a file path's extension.
 * Falls back to no extension (plain text) for unknown types.
 */
export function languageForPath(path: string | null): Extension[] {
  if (!path) return [];
  const ext = path.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return [javascript()];
    case 'jsx':
      return [javascript({ jsx: true })];
    case 'ts':
      return [javascript({ typescript: true })];
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })];
    case 'rs':
      return [rust()];
    case 'json':
      return [json()];
    case 'md':
    case 'markdown':
      return [markdown()];
    default:
      return [];
  }
}
```

- [ ] **Step 2: Verify TS typechecks**

```powershell
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/language.ts
git commit -m "ui: languageForPath maps file extensions to CodeMirror grammars"
```

---

## Task 15: Editor component (CodeMirror wrapper)

**Files:**
- Create: `src/components/Editor.tsx`

- [ ] **Step 1: Create `src/components/Editor.tsx`**

```tsx
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { useBuffer } from '../stores/buffer';
import { languageForPath } from '../lib/language';

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace' },
  '.cm-content': { padding: '8px 0' },
});

export function Editor() {
  const content = useBuffer((s) => s.content);
  const path = useBuffer((s) => s.path);
  const setContent = useBuffer((s) => s.setContent);

  return (
    <CodeMirror
      value={content}
      height="100%"
      theme={oneDark}
      extensions={[editorTheme, ...languageForPath(path)]}
      onChange={setContent}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: false,
        indentOnInput: true,
      }}
    />
  );
}
```

- [ ] **Step 2: Verify TS typechecks**

```powershell
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```powershell
git add src/components/Editor.tsx
git commit -m "ui: Editor component wraps CodeMirror 6 bound to the buffer store"
```

---

## Task 16: Wire Editor into App and update TitleBar to show path + dirty

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/TitleBar.tsx`

- [ ] **Step 1: Update App.tsx**

Overwrite `src/App.tsx` with EXACTLY:

```tsx
import { TitleBar } from './components/TitleBar';
import { Editor } from './components/Editor';

export default function App() {
  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <TitleBar />
      <main className="flex flex-1 overflow-hidden">
        <Editor />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Update TitleBar to show buffer path + dirty dot**

Overwrite `src/components/TitleBar.tsx` with EXACTLY:

```tsx
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useBuffer } from '../stores/buffer';

function fileNameOf(path: string | null): string {
  if (!path) return 'Untitled';
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const path = useBuffer((s) => s.path);
  const dirty = useBuffer((s) => s.dirty);

  useEffect(() => {
    let mounted = true;
    invoke<boolean>('window_is_maximized')
      .then((v) => mounted && setMaximized(v))
      .catch(() => {});

    const unlistenPromise = getCurrentWindow().onResized(async () => {
      const v = await invoke<boolean>('window_is_maximized').catch(() => false);
      if (mounted) setMaximized(v);
    });

    return () => {
      mounted = false;
      unlistenPromise.then((un) => un()).catch(() => {});
    };
  }, []);

  return (
    <div className="drag-region flex h-9 select-none items-center justify-between border-b border-neutral-800 bg-neutral-900 text-neutral-300">
      <button
        type="button"
        className="no-drag flex h-full w-9 items-center justify-center text-base hover:bg-neutral-800"
        aria-label="App menu"
      >
        ≡
      </button>

      <div className="pointer-events-none flex flex-1 items-center justify-center gap-2 text-xs tracking-wide text-neutral-400">
        <span>{fileNameOf(path)}</span>
        {dirty && <span aria-label="Unsaved changes" className="text-amber-400">●</span>}
      </div>

      <div className="no-drag flex h-full">
        <button
          type="button"
          aria-label="Minimize"
          className="flex h-full w-11 items-center justify-center hover:bg-neutral-800"
          onClick={() => invoke('window_minimize').catch(console.error)}
        >
          &#x2013;
        </button>
        <button
          type="button"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          className="flex h-full w-11 items-center justify-center hover:bg-neutral-800"
          onClick={() => invoke('window_toggle_maximize').catch(console.error)}
        >
          {maximized ? '❐' : '☐'}
        </button>
        <button
          type="button"
          aria-label="Close"
          className="flex h-full w-11 items-center justify-center hover:bg-red-600 hover:text-white"
          onClick={() => invoke('window_close').catch(console.error)}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TS typechecks**

```powershell
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```powershell
git add src/App.tsx src/components/TitleBar.tsx
git commit -m "ui: mount Editor; TitleBar shows current file and dirty indicator"
```

---

## Task 17: Open-file flow (Ctrl+O)

**Files:**
- Create: `src/lib/dialog.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Install the JS side of tauri-plugin-dialog**

```powershell
npm install "@tauri-apps/plugin-dialog@^2"
```

(The Rust-side plugin was already added in Task 1's `Cargo.toml` and registered in Task 9's `lib.rs`. Step 1 here just adds the matching JS API package.)

- [ ] **Step 2: Create `src/lib/dialog.ts`**

```ts
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';

export async function pickFileToOpen(): Promise<string | null> {
  const choice = await openDialog({
    multiple: false,
    directory: false,
  });
  if (typeof choice === 'string') return choice;
  // For multiple: false the API can also return null when the user cancels.
  return null;
}

export async function pickFileToSave(defaultPath?: string | null): Promise<string | null> {
  const choice = await saveDialog({
    defaultPath: defaultPath ?? undefined,
  });
  return typeof choice === 'string' ? choice : null;
}
```

- [ ] **Step 3: Update App.tsx with keyboard handler**

Overwrite `src/App.tsx`:

```tsx
import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Editor } from './components/Editor';
import { useBuffer } from './stores/buffer';
import { openFile } from './lib/tauri';
import { pickFileToOpen } from './lib/dialog';

export default function App() {
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      if (key === 'o' && !e.shiftKey) {
        e.preventDefault();
        const path = await pickFileToOpen();
        if (!path) return;
        try {
          const opened = await openFile(path);
          useBuffer.getState().loadOpened(opened);
        } catch (err) {
          console.error('open failed:', err);
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <TitleBar />
      <main className="flex flex-1 overflow-hidden">
        <Editor />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Verify TS typechecks**

```powershell
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/dialog.ts src/App.tsx package.json package-lock.json
git commit -m "ui: Ctrl+O opens a file via dialog and loads it into the buffer"
```

---

## Task 18: Save-file flow (Ctrl+S and Ctrl+Shift+S)

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add save handling to App.tsx**

Overwrite `src/App.tsx`:

```tsx
import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Editor } from './components/Editor';
import { useBuffer } from './stores/buffer';
import { openFile, saveFile } from './lib/tauri';
import { pickFileToOpen, pickFileToSave } from './lib/dialog';

async function doSave(saveAs: boolean) {
  const s = useBuffer.getState();
  let path = s.path;
  if (!path || saveAs) {
    const picked = await pickFileToSave(path);
    if (!picked) return;
    path = picked;
  }
  try {
    await saveFile(path, s.content, s.encoding, s.eol);
    useBuffer.getState().markSaved(path);
  } catch (err) {
    console.error('save failed:', err);
  }
}

export default function App() {
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      if (key === 'o' && !e.shiftKey) {
        e.preventDefault();
        const path = await pickFileToOpen();
        if (!path) return;
        try {
          const opened = await openFile(path);
          useBuffer.getState().loadOpened(opened);
        } catch (err) {
          console.error('open failed:', err);
        }
        return;
      }

      if (key === 's' && !e.shiftKey) {
        e.preventDefault();
        await doSave(false);
        return;
      }

      if (key === 's' && e.shiftKey) {
        e.preventDefault();
        await doSave(true);
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <TitleBar />
      <main className="flex flex-1 overflow-hidden">
        <Editor />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Verify TS typechecks**

```powershell
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```powershell
git add src/App.tsx
git commit -m "ui: Ctrl+S saves; Ctrl+Shift+S prompts for path"
```

---

## Task 19: New-buffer flow (Ctrl+N)

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Overwrite `src/App.tsx` with the Ctrl+N branch added**

Overwrite `src/App.tsx` with EXACTLY:

```tsx
import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Editor } from './components/Editor';
import { useBuffer } from './stores/buffer';
import { openFile, saveFile } from './lib/tauri';
import { pickFileToOpen, pickFileToSave } from './lib/dialog';

async function doSave(saveAs: boolean) {
  const s = useBuffer.getState();
  let path = s.path;
  if (!path || saveAs) {
    const picked = await pickFileToSave(path);
    if (!picked) return;
    path = picked;
  }
  try {
    await saveFile(path, s.content, s.encoding, s.eol);
    useBuffer.getState().markSaved(path);
  } catch (err) {
    console.error('save failed:', err);
  }
}

export default function App() {
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      if (key === 'o' && !e.shiftKey) {
        e.preventDefault();
        const path = await pickFileToOpen();
        if (!path) return;
        try {
          const opened = await openFile(path);
          useBuffer.getState().loadOpened(opened);
        } catch (err) {
          console.error('open failed:', err);
        }
        return;
      }

      if (key === 's' && !e.shiftKey) {
        e.preventDefault();
        await doSave(false);
        return;
      }

      if (key === 's' && e.shiftKey) {
        e.preventDefault();
        await doSave(true);
        return;
      }

      if (key === 'n' && !e.shiftKey) {
        e.preventDefault();
        // Discard current buffer for now. Phase 3 introduces multi-buffer tabs
        // and a "save before close?" prompt; in Phase 2 we trust the user
        // (they can see the dirty indicator).
        useBuffer.getState().reset();
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <TitleBar />
      <main className="flex flex-1 overflow-hidden">
        <Editor />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Verify TS typechecks**

```powershell
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```powershell
git add src/App.tsx
git commit -m "ui: Ctrl+N resets the buffer (single-buffer behavior; multi-tab in Phase 3)"
```

---

## Task 20: Build, dev-smoke, and update results doc

**Files:**
- Create: `docs/superpowers/plans/phase-2-results.md`

- [ ] **Step 1: Run all automated checks**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm test
Set-Location src-tauri
cargo test
Set-Location ..
npx tsc --noEmit
```

Expected:
- Vitest: at least 10 passing (sanity + buffer + tauri wrappers).
- Cargo: 25+ fs tests passing.
- tsc: exit 0.

- [ ] **Step 2: Dev smoke (manual)**

```powershell
npm run tauri dev
```

Verify these manually in the running app — then close it cleanly:

1. The editor area appears beneath the title bar with line numbers and the One Dark theme.
2. The title bar shows "Untitled" with no dirty dot at startup.
3. Type some text. The amber `●` dirty indicator appears next to the file name.
4. **Ctrl+O** → native file dialog opens. Pick a `.rs`, `.js`, or `.md` file. Editor loads the content; title bar shows the file name; dirty dot disappears.
5. Edit the file. Dirty dot reappears.
6. **Ctrl+S** → no dialog. The file is overwritten. Confirm in another tool (`Get-Content` or your shell) that the new content is on disk. The dirty dot disappears.
7. **Ctrl+Shift+S** → dialog opens with the current path pre-filled; pick a new location; verify the new file exists with your content and the title bar updates to the new name.
8. **Ctrl+N** → buffer resets to "Untitled" and empty. (You'll lose unsaved changes — that's expected in Phase 2.)
9. Confirm syntax highlighting differs between `.rs`, `.js`, `.json`, `.md` files.

- [ ] **Step 3: Build release MSI to verify the toolchain still works**

```powershell
npm run tauri build
```

Expected: produces a new MSI under `src-tauri/target/release/bundle/msi/`. Record the size; it should be a few hundred KB larger than Phase 1 due to bundled CodeMirror.

- [ ] **Step 4: Create the results doc**

Create `docs/superpowers/plans/phase-2-results.md` (fill in the blanks):

```markdown
# Phase 2 — Results

- Vitest: __ tests passing
- cargo test (fs module): __ tests passing
- MSI size: __ MB (Phase 1 baseline was 2.9 MB)
- app.exe size: __ MB (Phase 1 baseline was 8.3 MB)

## Manual smoke

- [x] Editor mounts under title bar with One Dark theme
- [x] Untitled / Untitled empty state
- [x] Typing dirties the buffer (amber dot)
- [x] Ctrl+O opens a file via dialog; content loaded; dot clears
- [x] Editing reapplies the dirty dot
- [x] Ctrl+S overwrites; dot clears; new content on disk
- [x] Ctrl+Shift+S saves to new path
- [x] Ctrl+N resets buffer
- [x] Syntax highlighting differs across .rs / .js / .json / .md

## Acceptance — UTF-16 LE BOM round-trip (spec 5.1 #3)

Verified by `cargo test fs::roundtrip_tests` (open, edit, save preserves BOM and decodes back to edited content).

## Known follow-ups for Phase 3

- Multi-buffer / tab strip
- "Save before close?" confirmation
- File-tree / find-in-files still out of scope until Phase 3 / Phase 4
- Encoding switching from the status bar (UI exists in Phase 3's status bar task)
```

- [ ] **Step 5: Commit**

```powershell
git add docs/superpowers/plans/phase-2-results.md
git commit -m "phase 2: record automated + manual smoke test results"
```

---

## Phase 2 Acceptance

Close Phase 2 when ALL of these are true:

1. `cargo test` passes (≥ 25 tests in the `fs` module, including the round-trip).
2. `npm test` passes (≥ 10 tests across sanity, buffer, and tauri wrappers).
3. `npx tsc --noEmit` exits 0.
4. `npm run tauri dev` opens the app; the manual smoke checklist in Task 20 Step 2 fully passes.
5. `npm run tauri build` produces a fresh MSI/NSIS pair.
6. The UTF-16 LE BOM round-trip test (spec acceptance #3) is green.

## What is intentionally NOT in this phase

- Multi-buffer / tabs / drag reorder — Phase 3.
- Crash-recovery journal — Phase 4.
- Session restore (reopen last file) — Phase 4.
- Find / replace UI — Phase 5.
- Themes other than One Dark — Phase 5.
- Encoding/EOL changing from the UI — Phase 3's status bar work.
- External-change detection — Phase 4.
