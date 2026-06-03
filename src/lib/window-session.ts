import { useBuffers } from '../stores/buffers';
import { useWorkspace } from '../stores/workspace';
import { useEditorPrefs } from '../stores/editorPrefs';
import { useRecentFiles } from '../stores/recentFiles';
import type { AppSession, WindowSession } from './tauri';

/** Snapshot the live per-window store state into a WindowSession. */
export function currentWindowSession(label: string): WindowSession {
  const s = useBuffers.getState();
  return {
    label,
    tabs: s.buffers.map((b) => ({
      buffer_id: b.id,
      path: b.path,
      cursor: b.cursor,
      scroll_top: b.scrollTop,
    })),
    active_id: s.activeId,
    workspace_folder: useWorkspace.getState().workspaceFolder,
    split_active: s.splitActive,
    secondary_id: s.secondaryId,
    focused_pane: s.focusedPane,
    secondary_pane_state: Array.from(s.secondaryPaneState.entries()).map(
      ([buffer_id, v]) => ({ buffer_id, cursor: v.cursor, scroll_top: v.scrollTop }),
    ),
  };
}

/** Apply the app-global slice (editor prefs + recent lists) of a loaded session. */
export function applyAppGlobal(app: AppSession): void {
  const prefs = app.editor_prefs ?? {};
  if (prefs.word_wrap != null) useEditorPrefs.getState().setWordWrap(prefs.word_wrap);
  if (prefs.indent_guides != null) useEditorPrefs.getState().setIndentGuides(prefs.indent_guides);
  if (prefs.minimap != null) useEditorPrefs.getState().setMinimap(prefs.minimap);
  useRecentFiles.getState().setRecent(app.recent_files ?? []);
}
