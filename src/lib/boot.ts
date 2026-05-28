import { useBuffers, type Encoding, type LineEnding } from '../stores/buffers';
import { journalReplay, sessionLoad, openFile } from './tauri';
import { useWorkspace } from '../stores/workspace';

function asEncoding(s: string): Encoding {
  if (s === 'utf-8' || s === 'utf-8-bom' || s === 'utf-16-le' || s === 'utf-16-be') return s;
  return 'utf-8';
}
function asEol(s: string): LineEnding {
  if (s === 'lf' || s === 'crlf' || s === 'cr') return s;
  return 'lf';
}

/**
 * One-shot startup: restore buffers from journal + session.
 * Idempotent — if buffers already exist, does nothing.
 */
export async function bootRestore(): Promise<void> {
  if (useBuffers.getState().buffers.length > 0) return;

  const [journalEntries, session] = await Promise.all([
    journalReplay().catch((err) => {
      console.error('journal_replay failed at boot:', err);
      return [];
    }),
    sessionLoad().catch((err) => {
      console.error('session_load failed at boot:', err);
      return { tabs: [], active_id: null, workspace_folder: null, recent_folders: [] };
    }),
  ]);

  useWorkspace.getState().setFolder(session.workspace_folder ?? null);

  const fromSession = session.recent_folders ?? [];
  const wf = session.workspace_folder;
  if (wf) {
    const lower = wf.toLowerCase();
    const filtered = fromSession.filter((p) => p.toLowerCase() !== lower);
    useWorkspace.getState().setRecent([wf, ...filtered].slice(0, 10));
  } else {
    useWorkspace.getState().setRecent(fromSession);
  }

  const journalById = new Map(journalEntries.map((e) => [e.buffer_id, e]));

  // First pass: restore dirty buffers from journals (id-preserving).
  for (const entry of journalEntries) {
    useBuffers.getState().openRestored({
      bufferId: entry.buffer_id,
      path: entry.snapshot.path,
      content: entry.snapshot.content,
      encoding: asEncoding(entry.snapshot.encoding),
      eol: asEol(entry.snapshot.eol),
      dirty: true,
    });
  }

  // Second pass: for each session tab that does NOT have a journal AND has a
  // path on disk, open it as a clean buffer.
  for (const tab of session.tabs) {
    if (journalById.has(tab.buffer_id)) continue;
    if (tab.path == null) continue; // untitled-clean: nothing to restore
    try {
      const opened = await openFile(tab.path);
      // Preserve the original buffer id so subsequent sessions are stable.
      useBuffers.getState().openRestored({
        bufferId: tab.buffer_id,
        path: opened.path,
        content: opened.content,
        encoding: opened.encoding,
        eol: opened.eol,
        dirty: false,
      });
    } catch (err) {
      console.error(`bootRestore: failed to open ${tab.path}:`, err);
      // Skip this tab; it's been deleted/renamed since the last session.
    }
  }

  // Activate the recorded active id if it exists in the store; otherwise first.
  const state = useBuffers.getState();
  if (state.buffers.length === 0) return;
  const target =
    session.active_id && state.buffers.some((b) => b.id === session.active_id)
      ? session.active_id
      : state.buffers[0].id;
  useBuffers.getState().switchTo(target);
}
