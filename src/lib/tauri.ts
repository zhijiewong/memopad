import { invoke } from '@tauri-apps/api/core';
import type { OpenedFile, Encoding, LineEnding } from '../stores/buffer';

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
