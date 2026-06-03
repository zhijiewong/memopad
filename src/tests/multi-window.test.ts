import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'main' }) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import { useBuffers } from '../stores/buffers';
import { useWorkspace } from '../stores/workspace';
import { useEditorPrefs } from '../stores/editorPrefs';
import { useRecentFiles } from '../stores/recentFiles';
import { currentWindowSession, applyAppGlobal } from '../lib/window-session';
import type { AppSession } from '../lib/tauri';

describe('currentWindowSession', () => {
  beforeEach(() => {
    useBuffers.setState(useBuffers.getInitialState(), true);
    useWorkspace.setState(useWorkspace.getInitialState(), true);
    useWorkspace.getState().setFolder('C:/proj');
  });

  it('maps store state to a WindowSession', () => {
    const id = useBuffers.getState().openBuffer({
      path: 'C:/a.txt', content: 'x', encoding: 'utf-8', eol: 'lf',
    });
    const ws = currentWindowSession('main');
    expect(ws.label).toBe('main');
    expect(ws.workspace_folder).toBe('C:/proj');
    expect(ws.tabs[0].buffer_id).toBe(id);
    expect(ws.active_id).toBe(id);
  });

  it('serializes the split-pane state', () => {
    const a = useBuffers.getState().openBuffer({ path: 'C:/a.txt', content: 'a', encoding: 'utf-8', eol: 'lf' });
    const b = useBuffers.getState().openBuffer({ path: 'C:/b.txt', content: 'b', encoding: 'utf-8', eol: 'lf' });
    useBuffers.getState().restoreSplitState({
      splitActive: true,
      secondaryId: b,
      focusedPane: 'secondary',
      secondaryPaneState: [{ bufferId: b, cursor: 4, scrollTop: 8 }],
    });
    const ws = currentWindowSession('win-1');
    expect(ws.split_active).toBe(true);
    expect(ws.secondary_id).toBe(b);
    expect(ws.focused_pane).toBe('secondary');
    expect(ws.secondary_pane_state).toContainEqual({ buffer_id: b, cursor: 4, scroll_top: 8 });
    expect(ws.tabs.map((t) => t.buffer_id)).toEqual([a, b]);
  });
});

describe('applyAppGlobal', () => {
  beforeEach(() => {
    useEditorPrefs.getState().reset();
    useRecentFiles.getState().clear();
  });

  function app(over: Partial<AppSession>): AppSession {
    return { windows: [], editor_prefs: {}, recent_folders: [], recent_files: [], ...over };
  }

  it('applies non-null editor prefs and recent files', () => {
    applyAppGlobal(app({
      editor_prefs: { word_wrap: true, indent_guides: false, minimap: true },
      recent_files: ['C:/a.txt', 'C:/b.txt'],
    }));
    expect(useEditorPrefs.getState().wordWrap).toBe(true);
    expect(useEditorPrefs.getState().indentGuides).toBe(false);
    expect(useEditorPrefs.getState().minimap).toBe(true);
    expect(useRecentFiles.getState().recentFiles).toEqual(['C:/a.txt', 'C:/b.txt']);
  });

  it('leaves editor-pref defaults when fields are absent', () => {
    applyAppGlobal(app({ editor_prefs: {} }));
    expect(useEditorPrefs.getState().wordWrap).toBe(false);
    expect(useEditorPrefs.getState().indentGuides).toBe(true);
  });
});
