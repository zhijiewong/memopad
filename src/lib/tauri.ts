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
}

export interface RestoredEntry {
  buffer_id: string;
  snapshot: JournalSnapshot;
}

export interface TabEntry {
  buffer_id: string;
  path: string | null;
}

export interface SessionState {
  tabs: TabEntry[];
  active_id: string | null;
  workspace_folder?: string | null;
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

export async function journalReplay(): Promise<RestoredEntry[]> {
  try {
    return await invoke<RestoredEntry[]>('journal_replay');
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

export async function sessionSave(state: SessionState): Promise<void> {
  try {
    await invoke<void>('session_save', { state });
  } catch (e) {
    throw asError(e);
  }
}

export async function sessionLoad(): Promise<SessionState> {
  try {
    return await invoke<SessionState>('session_load');
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
