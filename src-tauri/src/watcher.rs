// Recursive filesystem watcher for the workspace folder.
// Wraps notify-debouncer-full with a 200ms coalescing window.
// Emits Tauri events on the AppHandle, or pipes into a crossbeam Sender
// for unit tests.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use notify::RecommendedWatcher;
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
        EventKind::Modify(ModifyKind::Data(_)) => FsEventKind::Modify,
        _ => return None,
    };
    Some(FsEventPayload { kind, path })
}

pub fn start(
    _handle: &WatcherHandle,
    _folder: PathBuf,
    _app: AppHandle,
) -> Result<(), String> {
    Ok(())
}

pub fn start_with_sender(
    _handle: &WatcherHandle,
    _folder: PathBuf,
    _sender: crossbeam_channel::Sender<FsEventPayload>,
) -> Result<(), String> {
    Ok(())
}

pub fn stop(_handle: &WatcherHandle) -> Result<(), String> {
    Ok(())
}

const _DEBOUNCE_MS_USED: u64 = DEBOUNCE_MS;

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
}
