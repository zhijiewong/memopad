// stat helper used by the JS side to detect when a file on disk has changed
// since it was opened.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileStat {
    /// Last-modified time as milliseconds since the Unix epoch.
    pub mtime_ms: i64,
    pub size: u64,
}

/// Read mtime + size for `path`. Missing file returns Err.
pub fn stat_path(path: &str) -> std::io::Result<FileStat> {
    let meta = std::fs::metadata(path)?;
    let mtime = meta.modified()?;
    let mtime_ms = mtime
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Ok(FileStat { mtime_ms, size: meta.len() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_file(name: &str, content: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "memopad_stat_{}_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
            std::process::id(),
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn returns_size_of_file() {
        let path = tmp_file("a.txt", b"hello");
        let s = stat_path(&path.to_string_lossy()).unwrap();
        assert_eq!(s.size, 5);
    }

    #[test]
    fn mtime_changes_after_rewrite() {
        let path = tmp_file("b.txt", b"v1");
        let before = stat_path(&path.to_string_lossy()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
        std::fs::write(&path, b"v2 longer").unwrap();
        let after = stat_path(&path.to_string_lossy()).unwrap();
        assert!(after.size != before.size || after.mtime_ms > before.mtime_ms);
    }

    #[test]
    fn missing_file_errors() {
        let res = stat_path("Z:\\does\\not\\exist\\nope.txt");
        assert!(res.is_err());
    }
}
