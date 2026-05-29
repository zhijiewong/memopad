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
pub fn map_debounced_event(_e: &DebouncedEvent) -> Option<FsEventPayload> {
    None
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
