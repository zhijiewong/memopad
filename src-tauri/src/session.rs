// Single-file session record: the set of open tabs and active id at the time
// of a clean shutdown. Written on clean exit; read on startup.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TabEntry {
    pub buffer_id: String,
    pub path: Option<String>,
    #[serde(default)]
    pub cursor: Option<f64>,
    #[serde(default)]
    pub scroll_top: Option<f64>,
}

/// Which editor pane has focus. Serializes lowercase to match the TS union
/// `'primary' | 'secondary'`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum PaneSide {
    #[default]
    Primary,
    Secondary,
}

/// Per-buffer cursor/scroll for the secondary pane (mirrors the store's
/// `secondaryPaneState` Map).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PaneCursor {
    pub buffer_id: String,
    pub cursor: Option<f64>,
    pub scroll_top: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionState {
    pub tabs: Vec<TabEntry>,
    pub active_id: Option<String>,
    #[serde(default)]
    pub workspace_folder: Option<String>,
    #[serde(default)]
    pub recent_folders: Vec<String>,
    #[serde(default)]
    pub split_active: bool,
    #[serde(default)]
    pub secondary_id: Option<String>,
    #[serde(default)]
    pub focused_pane: PaneSide,
    #[serde(default)]
    pub secondary_pane_state: Vec<PaneCursor>,
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            tabs: Vec::new(),
            active_id: None,
            workspace_folder: None,
            recent_folders: Vec::new(),
            split_active: false,
            secondary_id: None,
            focused_pane: PaneSide::Primary,
            secondary_pane_state: Vec::new(),
        }
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
                TabEntry { buffer_id: "b1".into(), path: Some("/a.txt".into()), cursor: None, scroll_top: None },
                TabEntry { buffer_id: "b2".into(), path: None, cursor: None, scroll_top: None },
            ],
            active_id: Some("b1".into()),
            workspace_folder: None,
            recent_folders: Vec::new(),
            split_active: false,
            secondary_id: None,
            focused_pane: PaneSide::Primary,
            secondary_pane_state: Vec::new(),
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
            tabs: vec![TabEntry { buffer_id: "old".into(), path: None, cursor: None, scroll_top: None }],
            active_id: None,
            workspace_folder: None,
            recent_folders: Vec::new(),
            split_active: false,
            secondary_id: None,
            focused_pane: PaneSide::Primary,
            secondary_pane_state: Vec::new(),
        }).unwrap();
        save_at(&dir, &SessionState::default()).unwrap();
        assert_eq!(load_at(&dir), SessionState::default());
    }

    #[test]
    fn loads_old_session_without_workspace_folder() {
        let dir = tmp();
        let legacy = r#"{"tabs":[{"buffer_id":"b1","path":"/a.txt"}],"active_id":"b1"}"#;
        std::fs::write(session_path(&dir), legacy).unwrap();
        let loaded = load_at(&dir);
        assert_eq!(loaded.workspace_folder, None);
        assert_eq!(loaded.tabs.len(), 1);
    }

    #[test]
    fn round_trips_workspace_folder() {
        let dir = tmp();
        let state = SessionState {
            tabs: vec![],
            active_id: None,
            workspace_folder: Some("C:\\proj".into()),
            recent_folders: Vec::new(),
            split_active: false,
            secondary_id: None,
            focused_pane: PaneSide::Primary,
            secondary_pane_state: Vec::new(),
        };
        save_at(&dir, &state).unwrap();
        assert_eq!(load_at(&dir).workspace_folder, Some("C:\\proj".into()));
    }

    #[test]
    fn loads_old_session_without_recent_folders() {
        let dir = tmp();
        let legacy = r#"{"tabs":[{"buffer_id":"b1","path":"/a.txt"}],"active_id":"b1","workspace_folder":"C:\\proj"}"#;
        std::fs::write(session_path(&dir), legacy).unwrap();
        let loaded = load_at(&dir);
        assert_eq!(loaded.recent_folders, Vec::<String>::new());
        assert_eq!(loaded.workspace_folder, Some("C:\\proj".into()));
        assert_eq!(loaded.tabs.len(), 1);
    }

    #[test]
    fn round_trips_recent_folders() {
        let dir = tmp();
        let state = SessionState {
            tabs: vec![],
            active_id: None,
            workspace_folder: None,
            recent_folders: vec!["C:\\a".into(), "C:\\b".into()],
            split_active: false,
            secondary_id: None,
            focused_pane: PaneSide::Primary,
            secondary_pane_state: Vec::new(),
        };
        save_at(&dir, &state).unwrap();
        assert_eq!(load_at(&dir).recent_folders, vec!["C:\\a".to_string(), "C:\\b".to_string()]);
    }
}
