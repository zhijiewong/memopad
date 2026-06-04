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
pub struct LegacySession {
    pub tabs: Vec<TabEntry>,
    pub active_id: Option<String>,
    #[serde(default)]
    pub workspace_folder: Option<String>,
    #[serde(default)]
    pub recent_folders: Vec<String>,
    #[serde(default)]
    pub recent_files: Vec<String>,
    #[serde(default)]
    pub split_active: bool,
    #[serde(default)]
    pub secondary_id: Option<String>,
    #[serde(default)]
    pub focused_pane: PaneSide,
    #[serde(default)]
    pub secondary_pane_state: Vec<PaneCursor>,
    #[serde(default)]
    pub word_wrap: Option<bool>,
    #[serde(default)]
    pub indent_guides: Option<bool>,
    #[serde(default)]
    pub minimap: Option<bool>,
}

impl Default for LegacySession {
    fn default() -> Self {
        Self {
            tabs: Vec::new(),
            active_id: None,
            workspace_folder: None,
            recent_folders: Vec::new(),
            recent_files: Vec::new(),
            split_active: false,
            secondary_id: None,
            focused_pane: PaneSide::Primary,
            secondary_pane_state: Vec::new(),
            word_wrap: None,
            indent_guides: None,
            minimap: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct EditorPrefs {
    #[serde(default)]
    pub word_wrap: Option<bool>,
    #[serde(default)]
    pub indent_guides: Option<bool>,
    #[serde(default)]
    pub minimap: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WindowSession {
    pub label: String,
    #[serde(default)]
    pub tabs: Vec<TabEntry>,
    #[serde(default)]
    pub active_id: Option<String>,
    #[serde(default)]
    pub workspace_folder: Option<String>,
    #[serde(default)]
    pub split_active: bool,
    #[serde(default)]
    pub secondary_id: Option<String>,
    #[serde(default)]
    pub focused_pane: PaneSide,
    #[serde(default)]
    pub secondary_pane_state: Vec<PaneCursor>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AppSession {
    #[serde(default)]
    pub windows: Vec<WindowSession>,
    #[serde(default)]
    pub editor_prefs: EditorPrefs,
    #[serde(default)]
    pub recent_folders: Vec<String>,
    #[serde(default)]
    pub recent_files: Vec<String>,
}

/// Parse session JSON into an AppSession, migrating the legacy flat shape.
pub fn parse_app_session(raw: &str) -> AppSession {
    let value: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return AppSession::default(),
    };
    if value.get("windows").is_some() {
        serde_json::from_value(value).unwrap_or_default()
    } else {
        let l: LegacySession = serde_json::from_value(value).unwrap_or_default();
        AppSession {
            windows: vec![WindowSession {
                label: "main".to_string(),
                tabs: l.tabs,
                active_id: l.active_id,
                workspace_folder: l.workspace_folder,
                split_active: l.split_active,
                secondary_id: l.secondary_id,
                focused_pane: l.focused_pane,
                secondary_pane_state: l.secondary_pane_state,
            }],
            editor_prefs: EditorPrefs {
                word_wrap: l.word_wrap,
                indent_guides: l.indent_guides,
                minimap: l.minimap,
            },
            recent_folders: l.recent_folders,
            recent_files: l.recent_files,
        }
    }
}

/// Read + migrate the on-disk session (empty default if absent/unreadable).
pub fn load_app_session(base_dir: &std::path::Path) -> AppSession {
    let path = session_path(base_dir);
    match std::fs::read_to_string(&path) {
        Ok(raw) => parse_app_session(&raw),
        Err(_) => AppSession::default(),
    }
}

/// Atomically write an AppSession to session.json (mirrors the existing save_at).
pub fn save_app_session(base_dir: &std::path::Path, app: &AppSession) -> std::io::Result<()> {
    use std::io::Write;
    std::fs::create_dir_all(base_dir)?;
    let path = session_path(base_dir);
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(app)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(json.as_bytes())?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// Atomically write the legacy session JSON to `<base_dir>/session.json`.
/// Test-only: production now uses `save_app_session`; retained so the legacy
/// round-trip / migration tests can exercise the on-disk legacy format.
#[cfg(test)]
pub fn save_at(base_dir: &std::path::Path, state: &LegacySession) -> std::io::Result<()> {
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

/// Read the legacy session JSON. Returns `Default` if missing or unparseable.
/// Test-only (see `save_at`).
#[cfg(test)]
pub fn load_at(base_dir: &std::path::Path) -> LegacySession {
    let content = match std::fs::read_to_string(session_path(base_dir)) {
        Ok(c) => c,
        Err(_) => return LegacySession::default(),
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
        let state = LegacySession {
            tabs: vec![
                TabEntry { buffer_id: "b1".into(), path: Some("/a.txt".into()), cursor: None, scroll_top: None },
                TabEntry { buffer_id: "b2".into(), path: None, cursor: None, scroll_top: None },
            ],
            active_id: Some("b1".into()),
            workspace_folder: None,
            recent_folders: Vec::new(),
            recent_files: Vec::new(),
            split_active: false,
            secondary_id: None,
            focused_pane: PaneSide::Primary,
            secondary_pane_state: Vec::new(),
            word_wrap: None,
            indent_guides: None,
            minimap: None,
        };
        save_at(&dir, &state).unwrap();
        let loaded = load_at(&dir);
        assert_eq!(loaded, state);
    }

    #[test]
    fn missing_file_returns_default() {
        let dir = tmp();
        let loaded = load_at(&dir);
        assert_eq!(loaded, LegacySession::default());
    }

    #[test]
    fn corrupt_file_returns_default() {
        let dir = tmp();
        std::fs::write(session_path(&dir), b"not valid json").unwrap();
        let loaded = load_at(&dir);
        assert_eq!(loaded, LegacySession::default());
    }

    #[test]
    fn save_overwrites_previous() {
        let dir = tmp();
        save_at(&dir, &LegacySession {
            tabs: vec![TabEntry { buffer_id: "old".into(), path: None, cursor: None, scroll_top: None }],
            active_id: None,
            workspace_folder: None,
            recent_folders: Vec::new(),
            recent_files: Vec::new(),
            split_active: false,
            secondary_id: None,
            focused_pane: PaneSide::Primary,
            secondary_pane_state: Vec::new(),
            word_wrap: None,
            indent_guides: None,
            minimap: None,
        }).unwrap();
        save_at(&dir, &LegacySession::default()).unwrap();
        assert_eq!(load_at(&dir), LegacySession::default());
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
        let state = LegacySession {
            tabs: vec![],
            active_id: None,
            workspace_folder: Some("C:\\proj".into()),
            recent_folders: Vec::new(),
            recent_files: Vec::new(),
            split_active: false,
            secondary_id: None,
            focused_pane: PaneSide::Primary,
            secondary_pane_state: Vec::new(),
            word_wrap: None,
            indent_guides: None,
            minimap: None,
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
        let state = LegacySession {
            tabs: vec![],
            active_id: None,
            workspace_folder: None,
            recent_folders: vec!["C:\\a".into(), "C:\\b".into()],
            recent_files: Vec::new(),
            split_active: false,
            secondary_id: None,
            focused_pane: PaneSide::Primary,
            secondary_pane_state: Vec::new(),
            word_wrap: None,
            indent_guides: None,
            minimap: None,
        };
        save_at(&dir, &state).unwrap();
        assert_eq!(load_at(&dir).recent_folders, vec!["C:\\a".to_string(), "C:\\b".to_string()]);
    }

    #[test]
    fn round_trips_split_state() {
        let dir = tmp();
        let state = LegacySession {
            tabs: vec![TabEntry {
                buffer_id: "b1".into(),
                path: Some("/a.txt".into()),
                cursor: Some(42.0),
                scroll_top: Some(13.5),
            }],
            active_id: Some("b1".into()),
            workspace_folder: None,
            recent_folders: Vec::new(),
            recent_files: Vec::new(),
            split_active: true,
            secondary_id: Some("b1".into()),
            focused_pane: PaneSide::Secondary,
            secondary_pane_state: vec![PaneCursor {
                buffer_id: "b1".into(),
                cursor: Some(7.0),
                scroll_top: Some(100.0),
            }],
            word_wrap: None,
            indent_guides: None,
            minimap: None,
        };
        save_at(&dir, &state).unwrap();
        assert_eq!(load_at(&dir), state);
    }

    #[test]
    fn loads_old_session_without_split_fields() {
        let dir = tmp();
        let legacy = r#"{"tabs":[{"buffer_id":"b1","path":"/a.txt"}],"active_id":"b1","workspace_folder":"C:\\proj","recent_folders":["C:\\a"]}"#;
        std::fs::write(session_path(&dir), legacy).unwrap();
        let loaded = load_at(&dir);
        assert_eq!(loaded.split_active, false);
        assert_eq!(loaded.secondary_id, None);
        assert_eq!(loaded.focused_pane, PaneSide::Primary);
        assert_eq!(loaded.secondary_pane_state, Vec::<PaneCursor>::new());
        // Legacy tabs deserialize with cursor/scroll defaulted to None.
        assert_eq!(loaded.tabs[0].cursor, None);
        assert_eq!(loaded.tabs[0].scroll_top, None);
    }

    #[test]
    fn session_state_defaults_editor_prefs_when_absent() {
        // Old session.json without the new fields must still deserialize.
        let json = r#"{ "tabs": [], "active_id": null }"#;
        let s: LegacySession = serde_json::from_str(json).unwrap();
        assert_eq!(s.word_wrap, None);
        assert_eq!(s.indent_guides, None);
    }

    #[test]
    fn session_state_roundtrips_editor_prefs() {
        let mut s = LegacySession::default();
        s.word_wrap = Some(true);
        s.indent_guides = Some(false);
        let json = serde_json::to_string(&s).unwrap();
        let back: LegacySession = serde_json::from_str(&json).unwrap();
        assert_eq!(back.word_wrap, Some(true));
        assert_eq!(back.indent_guides, Some(false));
    }

    #[test]
    fn session_state_defaults_minimap_when_absent() {
        let json = r#"{ "tabs": [], "active_id": null }"#;
        let s: LegacySession = serde_json::from_str(json).unwrap();
        assert_eq!(s.minimap, None);
    }

    #[test]
    fn session_state_roundtrips_minimap() {
        let mut s = LegacySession::default();
        s.minimap = Some(true);
        let json = serde_json::to_string(&s).unwrap();
        let back: LegacySession = serde_json::from_str(&json).unwrap();
        assert_eq!(back.minimap, Some(true));
    }

    #[test]
    fn session_state_defaults_recent_files_when_absent() {
        let json = r#"{ "tabs": [], "active_id": null }"#;
        let s: LegacySession = serde_json::from_str(json).unwrap();
        assert!(s.recent_files.is_empty());
    }

    #[test]
    fn session_state_roundtrips_recent_files() {
        let mut s = LegacySession::default();
        s.recent_files = vec!["C:/proj/a.txt".to_string(), "C:/proj/b.txt".to_string()];
        let json = serde_json::to_string(&s).unwrap();
        let back: LegacySession = serde_json::from_str(&json).unwrap();
        assert_eq!(back.recent_files, vec!["C:/proj/a.txt".to_string(), "C:/proj/b.txt".to_string()]);
    }

    #[test]
    fn migrates_legacy_flat_session_to_one_main_window() {
        let json = r#"{ "tabs": [{"buffer_id":"b1","path":"C:/a.txt"}], "active_id":"b1",
            "workspace_folder":"C:/proj", "word_wrap": true, "recent_files": ["C:/a.txt"] }"#;
        let app: AppSession = parse_app_session(json);
        assert_eq!(app.windows.len(), 1);
        assert_eq!(app.windows[0].label, "main");
        assert_eq!(app.windows[0].active_id.as_deref(), Some("b1"));
        assert_eq!(app.windows[0].workspace_folder.as_deref(), Some("C:/proj"));
        assert_eq!(app.editor_prefs.word_wrap, Some(true));
        assert_eq!(app.recent_files, vec!["C:/a.txt".to_string()]);
    }

    #[test]
    fn parses_new_multi_window_session() {
        let json = r#"{ "windows": [
            {"label":"main","tabs":[],"active_id":null},
            {"label":"win-1","tabs":[],"active_id":null,"workspace_folder":"C:/p2"}
        ], "editor_prefs": {"minimap": true}, "recent_folders": ["C:/p"] }"#;
        let app: AppSession = parse_app_session(json);
        assert_eq!(app.windows.len(), 2);
        assert_eq!(app.windows[1].label, "win-1");
        assert_eq!(app.windows[1].workspace_folder.as_deref(), Some("C:/p2"));
        assert_eq!(app.editor_prefs.minimap, Some(true));
    }

    #[test]
    fn empty_or_garbage_yields_default() {
        assert!(parse_app_session("").windows.is_empty());
        assert!(parse_app_session("not json").windows.is_empty());
    }

    #[test]
    fn pane_side_serializes_lowercase() {
        let primary = serde_json::to_string(&PaneSide::Primary).unwrap();
        let secondary = serde_json::to_string(&PaneSide::Secondary).unwrap();
        assert_eq!(primary, "\"primary\"");
        assert_eq!(secondary, "\"secondary\"");
    }
}
