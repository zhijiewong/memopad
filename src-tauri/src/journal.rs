// Append-only journal of unsaved buffer snapshots.
// One JSONL file per buffer id under <app_local_data>/journals/.
// Each line is a full snapshot; retain only the last RETAIN_SNAPSHOTS lines
// after every append to bound disk usage.

use serde::{Deserialize, Serialize};

/// Maximum snapshots retained per buffer journal file.
pub const RETAIN_SNAPSHOTS: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    /// File path on disk, or null for untitled buffers.
    pub path: Option<String>,
    pub content: String,
    /// Wire format matches src/stores/buffers.ts Encoding union.
    pub encoding: String,
    /// Wire format matches src/stores/buffers.ts LineEnding union.
    pub eol: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RestoredEntry {
    /// Buffer id this entry came from (filename without `.jsonl`).
    pub buffer_id: String,
    pub snapshot: Snapshot,
}

/// Append a snapshot for `buffer_id` under `journals_dir` and prune older
/// entries so at most `RETAIN_SNAPSHOTS` remain.
///
/// Pure function — takes the journals directory as a parameter so it can be
/// driven by tests with a tempdir.
pub fn snapshot_at(
    journals_dir: &std::path::Path,
    buffer_id: &str,
    snapshot: &Snapshot,
) -> std::io::Result<()> {
    use std::io::{Read, Write};
    let path = journal_file(journals_dir, buffer_id);

    // Read existing lines (if any), keep the last RETAIN_SNAPSHOTS-1 of them,
    // then write them + the new line back atomically and fsync.
    let mut existing = String::new();
    if let Ok(mut f) = std::fs::File::open(&path) {
        f.read_to_string(&mut existing)?;
    }

    let mut lines: Vec<&str> = existing.lines().collect();
    // Keep the LAST (RETAIN_SNAPSHOTS - 1) so this append produces RETAIN_SNAPSHOTS total.
    if lines.len() + 1 > RETAIN_SNAPSHOTS {
        let drop = lines.len() + 1 - RETAIN_SNAPSHOTS;
        lines.drain(0..drop);
    }

    let new_line = serde_json::to_string(snapshot)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    let tmp = path.with_extension("jsonl.tmp");
    {
        let mut f = std::fs::File::create(&tmp)?;
        for l in &lines {
            f.write_all(l.as_bytes())?;
            f.write_all(b"\n")?;
        }
        f.write_all(new_line.as_bytes())?;
        f.write_all(b"\n")?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

fn journal_file(journals_dir: &std::path::Path, buffer_id: &str) -> std::path::PathBuf {
    journals_dir.join(format!("{}.jsonl", buffer_id))
}

#[cfg(test)]
mod snapshot_tests {
    use super::*;

    fn tmp() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "memopad_journal_test_{}",
            uuid_like(),
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn uuid_like() -> String {
        format!(
            "{}_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            std::process::id(),
        )
    }

    fn snap(content: &str) -> Snapshot {
        Snapshot {
            path: Some("/tmp/x.txt".to_string()),
            content: content.to_string(),
            encoding: "utf-8".to_string(),
            eol: "lf".to_string(),
        }
    }

    #[test]
    fn first_snapshot_creates_the_file_with_one_jsonl_line() {
        let dir = tmp();
        snapshot_at(&dir, "buf1", &snap("hello")).unwrap();
        let path = journal_file(&dir, "buf1");
        assert!(path.exists());
        let content = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 1);
        let parsed: Snapshot = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(parsed.content, "hello");
    }

    #[test]
    fn multiple_snapshots_append_lines() {
        let dir = tmp();
        snapshot_at(&dir, "buf2", &snap("one")).unwrap();
        snapshot_at(&dir, "buf2", &snap("two")).unwrap();
        snapshot_at(&dir, "buf2", &snap("three")).unwrap();
        let content = std::fs::read_to_string(journal_file(&dir, "buf2")).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 3);
        let last: Snapshot = serde_json::from_str(lines[2]).unwrap();
        assert_eq!(last.content, "three");
    }

    #[test]
    fn snapshots_beyond_retention_drop_oldest() {
        let dir = tmp();
        for i in 0..(RETAIN_SNAPSHOTS + 5) {
            snapshot_at(&dir, "buf3", &snap(&i.to_string())).unwrap();
        }
        let content = std::fs::read_to_string(journal_file(&dir, "buf3")).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), RETAIN_SNAPSHOTS);
        let first: Snapshot = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first.content, "5");
        let last: Snapshot = serde_json::from_str(lines[lines.len() - 1]).unwrap();
        assert_eq!(last.content, (RETAIN_SNAPSHOTS + 4).to_string());
    }

    #[test]
    fn snapshot_creates_parent_dir_if_missing() {
        let dir = std::env::temp_dir().join(format!("memopad_journal_missing_{}", uuid_like()));
        let res = snapshot_at(&dir, "bufx", &snap("hi"));
        assert!(res.is_err());
    }

    #[test]
    fn each_line_round_trips_path_and_encoding() {
        let dir = tmp();
        let s = Snapshot {
            path: Some("/some/file.rs".to_string()),
            content: "fn main() {}".to_string(),
            encoding: "utf-16-le".to_string(),
            eol: "crlf".to_string(),
        };
        snapshot_at(&dir, "bufrt", &s).unwrap();
        let content = std::fs::read_to_string(journal_file(&dir, "bufrt")).unwrap();
        let parsed: Snapshot = serde_json::from_str(content.lines().next().unwrap()).unwrap();
        assert_eq!(parsed, s);
    }

    #[test]
    fn untitled_buffer_has_null_path() {
        let dir = tmp();
        let s = Snapshot {
            path: None,
            content: "untitled".to_string(),
            encoding: "utf-8".to_string(),
            eol: "lf".to_string(),
        };
        snapshot_at(&dir, "bufu", &s).unwrap();
        let content = std::fs::read_to_string(journal_file(&dir, "bufu")).unwrap();
        let parsed: Snapshot = serde_json::from_str(content.lines().next().unwrap()).unwrap();
        assert_eq!(parsed.path, None);
    }
}
