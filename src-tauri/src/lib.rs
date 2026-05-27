mod fs;
mod journal;
mod search;
mod session;
mod stat;

use std::process::Command;
use tauri::Manager;

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
fn journal_replay(app: tauri::AppHandle) -> Result<Vec<journal::RestoredEntry>, String> {
    let dir = journals_dir(&app)?;
    journal::replay_at(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn journal_clear(app: tauri::AppHandle, buffer_id: String) -> Result<(), String> {
    let dir = journals_dir(&app)?;
    journal::clear_at(&dir, &buffer_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn session_save(app: tauri::AppHandle, state: session::SessionState) -> Result<(), String> {
    let base = app_base_dir(&app)?;
    session::save_at(&base, &state).map_err(|e| e.to_string())
}

#[tauri::command]
fn session_load(app: tauri::AppHandle) -> Result<session::SessionState, String> {
    let base = app_base_dir(&app)?;
    Ok(session::load_at(&base))
}

#[tauri::command]
fn stat_file(path: String) -> Result<stat::FileStat, String> {
    stat::stat_path(&path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            session_save,
            session_load,
            stat_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
