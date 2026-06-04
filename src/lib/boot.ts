import { useBuffers, type Encoding, type LineEnding } from '../stores/buffers';
import {
  journalReplay,
  sessionLoad,
  sessionClaimWindow,
  sessionPendingCount,
  newWindow,
  openFile,
  type AppSession,
  type WindowSession,
  type RestoredEntry,
} from './tauri';
import { useWorkspace } from '../stores/workspace';
import { applyAppGlobal } from './window-session';
import { getCurrentWindow } from '@tauri-apps/api/window';

function asEncoding(s: string): Encoding {
  if (s === 'utf-8' || s === 'utf-8-bom' || s === 'utf-16-le' || s === 'utf-16-be') return s;
  return 'utf-8';
}
function asEol(s: string): LineEnding {
  if (s === 'lf' || s === 'crlf' || s === 'cr') return s;
  return 'lf';
}

/**
 * One-shot startup: restore this window's buffers from journal + its claimed
 * window session, apply app-global prefs/recents, then (main only) spawn the
 * remaining saved windows. Idempotent — if buffers already exist, does nothing.
 */
export async function bootRestore(): Promise<void> {
  if (useBuffers.getState().buffers.length > 0) return;

  const label = getCurrentWindow().label;

  const app = await sessionLoad().catch((err) => {
    console.error('session_load failed at boot:', err);
    const fallback: AppSession = {
      windows: [],
      editor_prefs: {},
      recent_folders: [],
      recent_files: [],
    };
    return fallback;
  });

  applyAppGlobal(app);

  const [journalEntries, claimed] = await Promise.all([
    journalReplay(label).catch((err) => {
      console.error('journal_replay failed at boot:', err);
      return [] as RestoredEntry[];
    }),
    sessionClaimWindow().catch((err) => {
      console.error('session_claim_window failed at boot:', err);
      return null;
    }),
  ]);

  // Restore the app-global recent-folders list, prepending this window's
  // workspace folder (mirrors the pre-multi-window behavior).
  const fromSession = app.recent_folders ?? [];
  const wf = claimed?.workspace_folder ?? null;
  if (wf) {
    const lower = wf.toLowerCase();
    const filtered = fromSession.filter((p) => p.toLowerCase() !== lower);
    useWorkspace.getState().setRecent([wf, ...filtered].slice(0, 10));
  } else {
    useWorkspace.getState().setRecent(fromSession);
  }

  await restoreWindow(claimed, journalEntries);

  if (label === 'main') {
    const pending = await sessionPendingCount().catch(() => 0);
    for (let i = 0; i < pending; i++) {
      await newWindow().catch((e) => console.warn('spawn window failed:', e));
    }
  }
}

/**
 * Restore a single window's tabs / active buffer / split layout from its
 * claimed WindowSession plus the per-window journal entries. The journal
 * provides dirty (unsaved) buffer contents; clean tabs are reopened from disk.
 */
async function restoreWindow(
  claimed: WindowSession | null,
  journalEntries: RestoredEntry[],
): Promise<void> {
  useWorkspace.getState().setFolder(claimed?.workspace_folder ?? null);

  const tabs = claimed?.tabs ?? [];
  const journalById = new Map(journalEntries.map((e) => [e.buffer_id, e]));
  const tabById = new Map(tabs.map((t) => [t.buffer_id, t]));

  // First pass: restore dirty buffers from journals (id-preserving).
  for (const entry of journalEntries) {
    const tab = tabById.get(entry.buffer_id);
    useBuffers.getState().openRestored({
      bufferId: entry.buffer_id,
      path: entry.snapshot.path,
      content: entry.snapshot.content,
      encoding: asEncoding(entry.snapshot.encoding),
      eol: asEol(entry.snapshot.eol),
      dirty: true,
      cursor: tab?.cursor ?? null,
      scrollTop: tab?.scroll_top ?? null,
    });
  }

  // Second pass: for each session tab that does NOT have a journal AND has a
  // path on disk, open it as a clean buffer.
  for (const tab of tabs) {
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
        cursor: tab.cursor ?? null,
        scrollTop: tab.scroll_top ?? null,
      });
    } catch (err) {
      console.error(`bootRestore: failed to open ${tab.path}:`, err);
      // Skip this tab; it's been deleted/renamed since the last session.
    }
  }

  // Activate the recorded active id if it exists in the store; otherwise first.
  const state = useBuffers.getState();
  if (state.buffers.length === 0) return;
  const activeId = claimed?.active_id ?? null;
  const target =
    activeId && state.buffers.some((b) => b.id === activeId)
      ? activeId
      : state.buffers[0].id;
  useBuffers.getState().switchTo(target);

  useBuffers.getState().restoreSplitState({
    splitActive: claimed?.split_active ?? false,
    secondaryId: claimed?.secondary_id ?? null,
    focusedPane: claimed?.focused_pane ?? 'primary',
    secondaryPaneState: (claimed?.secondary_pane_state ?? []).map((p) => ({
      bufferId: p.buffer_id,
      cursor: p.cursor ?? null,
      scrollTop: p.scroll_top ?? null,
    })),
  });
}
