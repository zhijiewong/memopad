// Recursive filesystem watcher for the workspace folder.
// Wraps notify-debouncer-full with a 200ms coalescing window.
// Emits Tauri events on the AppHandle, or pipes into a crossbeam Sender
// for unit tests.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, Watcher};
use notify_debouncer_full::{DebouncedEvent, Debouncer, FileIdMap, new_debouncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub struct WatcherHandle(pub Mutex<Option<Debouncer<RecommendedWatcher, FileIdMap>>>);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FsEventKind {
    Create,
    Remove,
    Modify,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FsEventPayload {
    pub kind: FsEventKind,
    pub path: String,
}

const DEBOUNCE_MS: u64 = 200;

/// Pure helper: map a notify-debouncer event to our payload.
/// Returns None for events we don't surface (rename half-events,
/// attribute-only changes, access events, etc.).
pub fn map_debounced_event(e: &DebouncedEvent) -> Option<FsEventPayload> {
    use notify::event::{EventKind, ModifyKind};

    let path = e.event.paths.first()?.to_string_lossy().to_string();
    let kind = match &e.event.kind {
        EventKind::Create(_) => FsEventKind::Create,
        EventKind::Remove(_) => FsEventKind::Remove,
        EventKind::Modify(ModifyKind::Data(_)) | EventKind::Modify(ModifyKind::Any) => FsEventKind::Modify,
        _ => return None,
    };
    Some(FsEventPayload { kind, path })
}

pub fn start_with_sender(
    handle: &WatcherHandle,
    folder: PathBuf,
    sender: crossbeam_channel::Sender<FsEventPayload>,
) -> Result<(), String> {
    use notify::RecursiveMode;

    if !folder.exists() {
        return Err(format!("path does not exist: {}", folder.display()));
    }
    let mut slot = handle.0.lock().map_err(|e| e.to_string())?;
    *slot = None;

    let mut debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        None,
        move |result: Result<Vec<DebouncedEvent>, Vec<notify::Error>>| {
            if let Ok(events) = result {
                for ev in &events {
                    if let Some(payload) = map_debounced_event(ev) {
                        let _ = sender.send(payload);
                    }
                }
            }
        },
    ).map_err(|e| format!("debouncer init: {}", e))?;

    debouncer
        .watcher()
        .watch(&folder, RecursiveMode::Recursive)
        .map_err(|e| format!("watch {:?}: {}", folder, e))?;

    *slot = Some(debouncer);
    Ok(())
}

pub fn start(
    handle: &WatcherHandle,
    folder: PathBuf,
    app: AppHandle,
) -> Result<(), String> {
    use notify::RecursiveMode;

    if !folder.exists() {
        return Err(format!("path does not exist: {}", folder.display()));
    }
    let mut slot = handle.0.lock().map_err(|e| e.to_string())?;
    *slot = None;

    let app_for_err = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        None,
        move |result: Result<Vec<DebouncedEvent>, Vec<notify::Error>>| {
            match result {
                Ok(events) => {
                    for ev in &events {
                        if let Some(payload) = map_debounced_event(ev) {
                            let _ = app.emit("fs:event", payload);
                        }
                    }
                }
                Err(errs) => {
                    let msg = errs.iter().map(|e| e.to_string()).collect::<Vec<_>>().join("; ");
                    let _ = app_for_err.emit("fs:error", serde_json::json!({ "message": msg }));
                }
            }
        },
    ).map_err(|e| format!("debouncer init: {}", e))?;

    debouncer
        .watcher()
        .watch(&folder, RecursiveMode::Recursive)
        .map_err(|e| format!("watch {:?}: {}", folder, e))?;

    *slot = Some(debouncer);
    Ok(())
}

pub fn stop(handle: &WatcherHandle) -> Result<(), String> {
    let mut slot = handle.0.lock().map_err(|e| e.to_string())?;
    *slot = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::{Event, EventKind};
    use notify::event::{CreateKind, ModifyKind, RemoveKind, DataChange, MetadataKind, RenameMode};

    fn debounced(kind: EventKind, path: &str) -> DebouncedEvent {
        DebouncedEvent {
            event: Event { kind, paths: vec![std::path::PathBuf::from(path)], attrs: Default::default() },
            time: std::time::Instant::now(),
        }
    }

    #[test]
    fn maps_create_event() {
        let e = debounced(EventKind::Create(CreateKind::File), "C:/proj/new.rs");
        let mapped = map_debounced_event(&e).unwrap();
        assert_eq!(mapped.kind, FsEventKind::Create);
        assert_eq!(mapped.path, "C:/proj/new.rs");
    }

    #[test]
    fn maps_modify_data_event() {
        let e = debounced(EventKind::Modify(ModifyKind::Data(DataChange::Content)), "C:/proj/foo.rs");
        let mapped = map_debounced_event(&e).unwrap();
        assert_eq!(mapped.kind, FsEventKind::Modify);
        assert_eq!(mapped.path, "C:/proj/foo.rs");
    }

    #[test]
    fn maps_remove_event() {
        let e = debounced(EventKind::Remove(RemoveKind::File), "C:/proj/gone.rs");
        let mapped = map_debounced_event(&e).unwrap();
        assert_eq!(mapped.kind, FsEventKind::Remove);
        assert_eq!(mapped.path, "C:/proj/gone.rs");
    }

    #[test]
    fn skips_modify_metadata_event() {
        let e = debounced(EventKind::Modify(ModifyKind::Metadata(MetadataKind::Permissions)), "C:/proj/foo.rs");
        assert!(map_debounced_event(&e).is_none());
    }

    #[test]
    fn skips_modify_name_event() {
        let e = debounced(EventKind::Modify(ModifyKind::Name(RenameMode::From)), "C:/proj/foo.rs");
        assert!(map_debounced_event(&e).is_none());
    }

    #[test]
    fn skips_event_without_paths() {
        let e = DebouncedEvent {
            event: Event { kind: EventKind::Create(CreateKind::File), paths: vec![], attrs: Default::default() },
            time: std::time::Instant::now(),
        };
        assert!(map_debounced_event(&e).is_none());
    }

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "memopad_watcher_{}_{}_{}",
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
            std::process::id(),
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fresh_handle() -> WatcherHandle {
        WatcherHandle(Mutex::new(None))
    }

    #[test]
    fn start_returns_err_for_nonexistent_path() {
        let h = fresh_handle();
        let (tx, _rx) = crossbeam_channel::unbounded::<FsEventPayload>();
        let missing = std::env::temp_dir().join("memopad_watcher_does_not_exist_xyz");
        let _ = std::fs::remove_dir_all(&missing);
        let result = start_with_sender(&h, missing, tx);
        assert!(result.is_err(), "expected Err for nonexistent path");
    }

    #[test]
    fn start_then_stop_drops_watcher() {
        let h = fresh_handle();
        let dir = tmp("startstop");
        let (tx, _rx) = crossbeam_channel::unbounded::<FsEventPayload>();
        start_with_sender(&h, dir, tx).unwrap();
        assert!(h.0.lock().unwrap().is_some(), "watcher should be present after start");
        stop(&h).unwrap();
        assert!(h.0.lock().unwrap().is_none(), "watcher should be None after stop");
    }

    #[test]
    fn emits_create_event_when_file_is_added() {
        let h = fresh_handle();
        let dir = tmp("create");
        let (tx, rx) = crossbeam_channel::unbounded::<FsEventPayload>();
        start_with_sender(&h, dir.clone(), tx).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        std::fs::write(dir.join("new.txt"), b"hi").unwrap();
        let payload = rx.recv_timeout(Duration::from_secs(2)).expect("expected an event");
        assert_eq!(payload.kind, FsEventKind::Create);
        assert!(payload.path.ends_with("new.txt"), "got {:?}", payload.path);
        stop(&h).unwrap();
    }

    #[test]
    fn emits_modify_event_when_file_is_written() {
        let h = fresh_handle();
        let dir = tmp("modify");
        let file = dir.join("foo.txt");
        std::fs::write(&file, b"v1").unwrap();
        let (tx, rx) = crossbeam_channel::unbounded::<FsEventPayload>();
        start_with_sender(&h, dir.clone(), tx).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        std::fs::write(&file, b"v2").unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        let mut found = false;
        while std::time::Instant::now() < deadline {
            if let Ok(p) = rx.recv_timeout(Duration::from_millis(200)) {
                if p.kind == FsEventKind::Modify && p.path.ends_with("foo.txt") {
                    found = true;
                    break;
                }
            }
        }
        assert!(found, "expected a Modify event for foo.txt");
        stop(&h).unwrap();
    }

    #[test]
    fn emits_remove_event_when_file_is_deleted() {
        let h = fresh_handle();
        let dir = tmp("remove");
        let file = dir.join("doomed.txt");
        std::fs::write(&file, b"bye").unwrap();
        let (tx, rx) = crossbeam_channel::unbounded::<FsEventPayload>();
        start_with_sender(&h, dir.clone(), tx).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        std::fs::remove_file(&file).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        let mut found = false;
        while std::time::Instant::now() < deadline {
            if let Ok(p) = rx.recv_timeout(Duration::from_millis(200)) {
                if p.kind == FsEventKind::Remove && p.path.ends_with("doomed.txt") {
                    found = true;
                    break;
                }
            }
        }
        assert!(found, "expected a Remove event for doomed.txt");
        stop(&h).unwrap();
    }
}
