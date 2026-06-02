import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorPrefs } from '../stores/editorPrefs';

describe('useEditorPrefs', () => {
  beforeEach(() => useEditorPrefs.getState().reset());

  it('defaults: wrap off, guides on', () => {
    expect(useEditorPrefs.getState().wordWrap).toBe(false);
    expect(useEditorPrefs.getState().indentGuides).toBe(true);
  });

  it('toggleWordWrap flips wordWrap', () => {
    useEditorPrefs.getState().toggleWordWrap();
    expect(useEditorPrefs.getState().wordWrap).toBe(true);
  });

  it('toggleIndentGuides flips indentGuides', () => {
    useEditorPrefs.getState().toggleIndentGuides();
    expect(useEditorPrefs.getState().indentGuides).toBe(false);
  });

  it('setters set explicit values', () => {
    useEditorPrefs.getState().setWordWrap(true);
    useEditorPrefs.getState().setIndentGuides(false);
    expect(useEditorPrefs.getState().wordWrap).toBe(true);
    expect(useEditorPrefs.getState().indentGuides).toBe(false);
  });

  it('reset returns to defaults', () => {
    useEditorPrefs.getState().setWordWrap(true);
    useEditorPrefs.getState().setIndentGuides(false);
    useEditorPrefs.getState().reset();
    expect(useEditorPrefs.getState().wordWrap).toBe(false);
    expect(useEditorPrefs.getState().indentGuides).toBe(true);
  });
});

import { vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { applyEditorPrefsFromSession } from '../lib/boot';

describe('useEditorPrefs minimap', () => {
  beforeEach(() => useEditorPrefs.getState().reset());

  it('defaults minimap off', () => {
    expect(useEditorPrefs.getState().minimap).toBe(false);
  });
  it('toggleMinimap flips it', () => {
    useEditorPrefs.getState().toggleMinimap();
    expect(useEditorPrefs.getState().minimap).toBe(true);
  });
  it('setMinimap sets it; reset clears it', () => {
    useEditorPrefs.getState().setMinimap(true);
    expect(useEditorPrefs.getState().minimap).toBe(true);
    useEditorPrefs.getState().reset();
    expect(useEditorPrefs.getState().minimap).toBe(false);
  });
});

describe('editor prefs session restore', () => {
  beforeEach(() => useEditorPrefs.getState().reset());

  it('applies non-null flags from session', () => {
    applyEditorPrefsFromSession({ word_wrap: true, indent_guides: false });
    expect(useEditorPrefs.getState().wordWrap).toBe(true);
    expect(useEditorPrefs.getState().indentGuides).toBe(false);
  });

  it('leaves defaults when fields are absent/null', () => {
    applyEditorPrefsFromSession({});
    expect(useEditorPrefs.getState().wordWrap).toBe(false);
    expect(useEditorPrefs.getState().indentGuides).toBe(true);
  });

  it('applies minimap from session', () => {
    applyEditorPrefsFromSession({ minimap: true });
    expect(useEditorPrefs.getState().minimap).toBe(true);
  });
});
