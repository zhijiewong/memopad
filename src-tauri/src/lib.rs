mod files;
mod fs;
mod journal;
mod search;
mod session;
mod stat;
mod watcher;

use std::collections::VecDeque;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::Manager;

struct SessionStore(std::sync::Mutex<session::AppSession>);
struct RestoreQueue(std::sync::Mutex<VecDeque<session::WindowSession>>);
struct WindowCounter(AtomicU32);

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
    // Use destroy(), not close(): close() emits a CloseRequested JS event,
    // which (with our subscription model) caused the window to remain open
    // on Windows/WebView2. The store subscription has already persisted
    // session.json on every state change, so we don't need to drain
    // anything before tearing down the window.
    window.destroy().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_is_maximized(window: tauri::Window) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    Command::new("explorer.exe")
        .arg("/select,")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("explorer /select,{}: {}", path, e))
}

fn app_base_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|e| format!("resolve app_local_data_dir: {}", e))
}

fn journals_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app_base_dir(app)?;
    let dir = base.join("journals");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir journals: {}", e))?;
    Ok(dir)
}

#[tauri::command]
fn journal_snapshot(
    app: tauri::AppHandle,
    buffer_id: String,
    snapshot: journal::Snapshot,
) -> Result<(), String> {
    let dir = journals_dir(&app)?;
    journal::snapshot_at(&dir, &buffer_id, &snapshot).map_err(|e| e.to_string())
}

#[tauri::command]
fn journal_replay(
    app: tauri::AppHandle,
    window_label: String,
) -> Result<Vec<journal::RestoredEntry>, String> {
    let dir = journals_dir(&app)?;
    journal::replay_for_label(&dir, &window_label).map_err(|e| e.to_string())
}

#[tauri::command]
fn journal_clear(app: tauri::AppHandle, buffer_id: String) -> Result<(), String> {
    let dir = journals_dir(&app)?;
    journal::clear_at(&dir, &buffer_id).map_err(|e| e.to_string())
}

fn persist_session(app: &tauri::AppHandle, store: &SessionStore) {
    if let Ok(base) = app_base_dir(app) {
        if let Ok(s) = store.0.lock() {
            let _ = session::save_app_session(&base, &s);
        }
    }
}

#[tauri::command]
fn session_load(store: tauri::State<SessionStore>) -> session::AppSession {
    store.0.lock().map(|s| s.clone()).unwrap_or_default()
}

#[tauri::command]
fn session_claim_window(queue: tauri::State<RestoreQueue>) -> Option<session::WindowSession> {
    queue.0.lock().ok().and_then(|mut q| q.pop_front())
}

#[tauri::command]
fn session_pending_count(queue: tauri::State<RestoreQueue>) -> usize {
    queue.0.lock().map(|q| q.len()).unwrap_or(0)
}

#[tauri::command]
fn session_save_window(
    app: tauri::AppHandle,
    store: tauri::State<SessionStore>,
    label: String,
    window: session::WindowSession,
) {
    if let Ok(mut s) = store.0.lock() {
        if let Some(slot) = s.windows.iter_mut().find(|w| w.label == label) {
            *slot = window;
        } else {
            s.windows.push(window);
        }
    }
    persist_session(&app, &store);
}

#[tauri::command]
fn session_save_app(
    app: tauri::AppHandle,
    store: tauri::State<SessionStore>,
    editor_prefs: session::EditorPrefs,
    recent_folders: Vec<String>,
    recent_files: Vec<String>,
) {
    if let Ok(mut s) = store.0.lock() {
        s.editor_prefs = editor_prefs;
        s.recent_folders = recent_folders;
        s.recent_files = recent_files;
    }
    persist_session(&app, &store);
}

#[tauri::command]
fn session_forget_window(
    app: tauri::AppHandle,
    store: tauri::State<SessionStore>,
    label: String,
) {
    if let Ok(mut s) = store.0.lock() {
        s.windows.retain(|w| w.label != label);
    }
    persist_session(&app, &store);
}

#[tauri::command]
fn window_count(app: tauri::AppHandle) -> usize {
    app.webview_windows().len()
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn new_window(
    app: tauri::AppHandle,
    counter: tauri::State<WindowCounter>,
) -> Result<String, String> {
    let label = format!("win-{}", counter.0.fetch_add(1, Ordering::SeqCst));
    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title("Memopad")
        .inner_size(1100.0, 720.0)
        .min_inner_size(480.0, 320.0)
        .decorations(false)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(label)
}

#[tauri::command]
fn stat_file(path: String) -> Result<stat::FileStat, String> {
    stat::stat_path(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn find_in_folder(
    folder: String,
    query: String,
    opts: search::FindOptions,
) -> Result<search::FindResponse, String> {
    search::find_in_folder(std::path::Path::new(&folder), &query, &opts)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_dir(workspace_folder: String, path: String)
    -> Result<Vec<files::DirEntry>, String> {
    files::list_dir_under(
        std::path::Path::new(&workspace_folder),
        std::path::Path::new(&path),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_file(workspace_folder: String, parent: String, name: String)
    -> Result<files::DirEntry, String> {
    files::create_file(
        std::path::Path::new(&workspace_folder),
        std::path::Path::new(&parent),
        &name,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_dir(workspace_folder: String, parent: String, name: String)
    -> Result<files::DirEntry, String> {
    files::create_dir(
        std::path::Path::new(&workspace_folder),
        std::path::Path::new(&parent),
        &name,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_path(workspace_folder: String, path: String, new_name: String)
    -> Result<String, String> {
    files::rename_entry(
        std::path::Path::new(&workspace_folder),
        std::path::Path::new(&path),
        &new_name,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn move_path(workspace_folder: String, src: String, dest_dir: String)
    -> Result<String, String> {
    files::move_entry(
        std::path::Path::new(&workspace_folder),
        std::path::Path::new(&src),
        std::path::Path::new(&dest_dir),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_path(workspace_folder: String, path: String) -> Result<(), String> {
    files::delete_entry(
        std::path::Path::new(&workspace_folder),
        std::path::Path::new(&path),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn walk_files(workspace_folder: String) -> Result<files::WalkResponse, String> {
    files::walk_files(std::path::Path::new(&workspace_folder)).map_err(|e| e.to_string())
}

#[tauri::command]
fn replace_in_files(
    folder: String,
    query: String,
    replacement: String,
    opts: search::FindOptions,
    target_paths: Option<Vec<String>>,
) -> Result<search::ReplaceResponse, String> {
    search::replace_in_files(
        std::path::Path::new(&folder),
        &query,
        &replacement,
        &opts,
        target_paths.as_deref(),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn watch_start(
    folder: String,
    handle: tauri::State<watcher::WatcherHandle>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    watcher::start(&handle, std::path::PathBuf::from(&folder), app)
}

#[tauri::command]
fn watch_stop(handle: tauri::State<watcher::WatcherHandle>) -> Result<(), String> {
    watcher::stop(&handle)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(watcher::WatcherHandle(std::sync::Mutex::new(None)))
        .setup(|app| {
            // Resolve the data dir + load/migrate the session now that the
            // AppHandle exists.
            let base = app_base_dir(&app.handle())
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let app_session = session::load_app_session(&base);

            // Seed the restore queue with every saved window slice; boot.ts on
            // the main window claims its slice then spawns the rest.
            let restore_q: VecDeque<session::WindowSession> =
                app_session.windows.iter().cloned().collect();

            // Next window-counter seed: above any restored win-N label.
            let seed = app_session
                .windows
                .iter()
                .filter_map(|w| w.label.strip_prefix("win-").and_then(|n| n.parse::<u32>().ok()))
                .max()
                .map(|m| m + 1)
                .unwrap_or(0);

            // In-memory reset of the canonical window list: it is rebuilt from
            // live labels as each window saves its slice.
            let mut canonical = app_session;
            canonical.windows.clear();

            app.manage(SessionStore(std::sync::Mutex::new(canonical)));
            app.manage(RestoreQueue(std::sync::Mutex::new(restore_q)));
            app.manage(WindowCounter(AtomicU32::new(seed)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_is_maximized,
            reveal_in_explorer,
            fs::open_file,
            fs::save_file,
            journal_snapshot,
            journal_replay,
            journal_clear,
            session_load,
            session_claim_window,
            session_pending_count,
            session_save_window,
            session_save_app,
            session_forget_window,
            window_count,
            quit_app,
            new_window,
            stat_file,
            find_in_folder,
            list_dir,
            create_file,
            create_dir,
            rename_path,
            move_path,
            delete_path,
            walk_files,
            replace_in_files,
            watch_start,
            watch_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
