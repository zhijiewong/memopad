import { invoke } from '@tauri-apps/api/core';
import type { OpenedFile, Encoding, LineEnding } from '../stores/buffers';

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e));
}

export async function openFile(path: string): Promise<OpenedFile> {
  try {
    return await invoke<OpenedFile>('open_file', { path });
  } catch (e) {
    throw asError(e);
  }
}

export async function saveFile(
  path: string,
  content: string,
  encoding: Encoding,
  eol: LineEnding,
): Promise<void> {
  try {
    await invoke<void>('save_file', { path, content, encoding, eol });
  } catch (e) {
    throw asError(e);
  }
}

export async function revealInExplorer(filePath: string): Promise<void> {
  try {
    await invoke<void>('reveal_in_explorer', { path: filePath });
  } catch (e) {
    throw asError(e);
  }
}

export interface JournalSnapshot {
  path: string | null;
  content: string;
  encoding: Encoding;
  eol: LineEnding;
  window_label: string;
}

export interface RestoredEntry {
  buffer_id: string;
  snapshot: JournalSnapshot;
}

export interface TabEntry {
  buffer_id: string;
  path: string | null;
  cursor?: number | null;
  scroll_top?: number | null;
}

export interface PaneCursor {
  buffer_id: string;
  cursor?: number | null;
  scroll_top?: number | null;
}

export interface EditorPrefsWire {
  word_wrap?: boolean | null;
  indent_guides?: boolean | null;
  minimap?: boolean | null;
}

export interface WindowSession {
  label: string;
  tabs: TabEntry[];
  active_id: string | null;
  workspace_folder?: string | null;
  split_active?: boolean;
  secondary_id?: string | null;
  focused_pane?: 'primary' | 'secondary';
  secondary_pane_state?: PaneCursor[];
}

export interface AppSession {
  windows: WindowSession[];
  editor_prefs: EditorPrefsWire;
  recent_folders: string[];
  recent_files: string[];
}

export interface FileStat {
  mtime_ms: number;
  size: number;
}

export async function journalSnapshot(
  bufferId: string,
  snapshot: JournalSnapshot,
): Promise<void> {
  try {
    await invoke<void>('journal_snapshot', { bufferId, snapshot });
  } catch (e) {
    throw asError(e);
  }
}

export async function journalReplay(windowLabel: string): Promise<RestoredEntry[]> {
  try {
    return await invoke<RestoredEntry[]>('journal_replay', { windowLabel });
  } catch (e) {
    throw asError(e);
  }
}

export async function journalClear(bufferId: string): Promise<void> {
  try {
    await invoke<void>('journal_clear', { bufferId });
  } catch (e) {
    throw asError(e);
  }
}

export async function sessionLoad(): Promise<AppSession> {
  try {
    return await invoke<AppSession>('session_load');
  } catch (e) {
    throw asError(e);
  }
}

export async function sessionClaimWindow(): Promise<WindowSession | null> {
  try {
    return await invoke<WindowSession | null>('session_claim_window');
  } catch (e) {
    throw asError(e);
  }
}

export async function sessionPendingCount(): Promise<number> {
  try {
    return await invoke<number>('session_pending_count');
  } catch (e) {
    throw asError(e);
  }
}

export async function sessionSaveWindow(windowSession: WindowSession): Promise<void> {
  try {
    await invoke<void>('session_save_window', { window: windowSession });
  } catch (e) {
    throw asError(e);
  }
}

export async function sessionSaveApp(
  editorPrefs: EditorPrefsWire,
  recentFolders: string[],
  recentFiles: string[],
): Promise<void> {
  try {
    await invoke<void>('session_save_app', { editorPrefs, recentFolders, recentFiles });
  } catch (e) {
    throw asError(e);
  }
}

export async function sessionForgetWindow(label: string): Promise<void> {
  try {
    await invoke<void>('session_forget_window', { label });
  } catch (e) {
    throw asError(e);
  }
}

export async function windowCount(): Promise<number> {
  try {
    return await invoke<number>('window_count');
  } catch (e) {
    throw asError(e);
  }
}

export async function quitApp(): Promise<void> {
  try {
    await invoke<void>('quit_app');
  } catch (e) {
    throw asError(e);
  }
}

export async function newWindow(): Promise<string> {
  try {
    return await invoke<string>('new_window');
  } catch (e) {
    throw asError(e);
  }
}

export async function statFile(path: string): Promise<FileStat> {
  try {
    return await invoke<FileStat>('stat_file', { path });
  } catch (e) {
    throw asError(e);
  }
}

export interface FindOptions {
  regex: boolean;
  case_sensitive: boolean;
  whole_word: boolean;
}

export interface LineMatch {
  line_number: number;
  line_text: string;
  match_ranges: [number, number][];
}

export interface FileMatch {
  path: string;
  matches: LineMatch[];
}

export interface FindResponse {
  files: FileMatch[];
  truncated: boolean;
  elapsed_ms: number;
  /** Frontend-only field populated by the workspace store when find_in_folder rejects. */
  error?: string;
}

export async function findInFolder(
  folder: string,
  query: string,
  opts: FindOptions,
): Promise<FindResponse> {
  return invoke<FindResponse>('find_in_folder', { folder, query, opts });
}

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export async function listDir(workspaceFolder: string, path: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>('list_dir', { workspaceFolder, path });
}

export async function createFile(
  workspaceFolder: string, parent: string, name: string,
): Promise<DirEntry> {
  return invoke<DirEntry>('create_file', { workspaceFolder, parent, name });
}

export async function createDir(
  workspaceFolder: string, parent: string, name: string,
): Promise<DirEntry> {
  return invoke<DirEntry>('create_dir', { workspaceFolder, parent, name });
}

export async function renamePath(
  workspaceFolder: string, path: string, newName: string,
): Promise<string> {
  return invoke<string>('rename_path', { workspaceFolder, path, newName });
}

export async function movePath(
  workspaceFolder: string, src: string, destDir: string,
): Promise<string> {
  return invoke<string>('move_path', { workspaceFolder, src, destDir });
}

export async function deletePath(workspaceFolder: string, path: string): Promise<void> {
  return invoke<void>('delete_path', { workspaceFolder, path });
}

export interface FileResult {
  path: string;
  matches_replaced: number;
  error: string | null;
}

export interface ReplaceResponse {
  results: FileResult[];
  total_files_replaced: number;
  total_matches_replaced: number;
}

export async function replaceInFiles(
  folder: string,
  query: string,
  replacement: string,
  opts: FindOptions,
  targetPaths: string[] | null,
): Promise<ReplaceResponse> {
  return invoke<ReplaceResponse>('replace_in_files', {
    folder, query, replacement, opts, targetPaths,
  });
}

export interface FsEventPayload {
  kind: 'create' | 'remove' | 'modify';
  path: string;
}

export async function watchStart(folder: string): Promise<void> {
  return invoke<void>('watch_start', { folder });
}

export async function watchStop(): Promise<void> {
  return invoke<void>('watch_stop');
}

export interface WalkResponse {
  files: string[];
  truncated: boolean;
  elapsed_ms: number;
}

export async function walkFiles(workspaceFolder: string): Promise<WalkResponse> {
  return invoke<WalkResponse>('walk_files', { workspaceFolder });
}
