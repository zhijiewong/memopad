// Single-file session record: the set of open tabs and active id at the time
// of a clean shutdown. Written on clean exit; read on startup.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TabEntry {
    pub buffer_id: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionState {
    pub tabs: Vec<TabEntry>,
    pub active_id: Option<String>,
}

impl Default for SessionState {
    fn default() -> Self {
        Self { tabs: Vec::new(), active_id: None }
    }
}

/// Atomically write the session JSON to `<base_dir>/session.json`.
pub fn save_at(base_dir: &std::path::Path, state: &SessionState) -> std::io::Result<()> {
    use std::io::Write;
    std::fs::create_dir_all(base_dir)?;
    let path = session_path(base_dir);
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(state)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(json.as_bytes())?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// Read the session JSON. Returns `Default` if the file is missing or unparseable.
pub fn load_at(base_dir: &std::path::Path) -> SessionState {
    let content = match std::fs::read_to_string(session_path(base_dir)) {
        Ok(c) => c,
        Err(_) => return SessionState::default(),
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn session_path(base_dir: &std::path::Path) -> std::path::PathBuf {
    base_dir.join("session.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "memopad_session_{}_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
            std::process::id(),
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn round_trip_via_save_then_load() {
        let dir = tmp();
        let state = SessionState {
            tabs: vec![
                TabEntry { buffer_id: "b1".into(), path: Some("/a.txt".into()) },
                TabEntry { buffer_id: "b2".into(), path: None },
            ],
            active_id: Some("b1".into()),
        };
        save_at(&dir, &state).unwrap();
        let loaded = load_at(&dir);
        assert_eq!(loaded, state);
    }

    #[test]
    fn missing_file_returns_default() {
        let dir = tmp();
        let loaded = load_at(&dir);
        assert_eq!(loaded, SessionState::default());
    }

    #[test]
    fn corrupt_file_returns_default() {
        let dir = tmp();
        std::fs::write(session_path(&dir), b"not valid json").unwrap();
        let loaded = load_at(&dir);
        assert_eq!(loaded, SessionState::default());
    }

    #[test]
    fn save_overwrites_previous() {
        let dir = tmp();
        save_at(&dir, &SessionState {
            tabs: vec![TabEntry { buffer_id: "old".into(), path: None }],
            active_id: None,
        }).unwrap();
        save_at(&dir, &SessionState::default()).unwrap();
        assert_eq!(load_at(&dir), SessionState::default());
    }
}
