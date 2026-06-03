import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { useBuffers, selectActive } from './stores/buffers';
import { useEditorPrefs } from './stores/editorPrefs';
import { useCursorPos } from './stores/cursorPos';
import { useRecentFiles } from './stores/recentFiles';

const w = window as unknown as {
  __memopadTestSetContent?: (s: string) => void;
  __memopadTestGetContent?: () => string;
  __memopadTestReset?: () => void;
  __memopadTestNewBuffer?: () => string;
  __memopadTestOpenBuffer?: (file: {
    path: string; content: string;
    encoding: 'utf-8' | 'utf-8-bom' | 'utf-16-le' | 'utf-16-be';
    eol: 'lf' | 'crlf' | 'cr';
  }) => string;
  __memopadTestCloseBuffer?: (id: string) => void;
  __memopadTestSwitchTo?: (id: string) => void;
  __memopadTestActiveId?: () => string | null;
  __memopadTestGetActiveBufferPath?: () => string | null;
  __memopadTestTabIds?: () => string[];
  __memopadTestSetExternalChange?: (id: string, flag: boolean) => void;
  __memopadTestRecordStat?: (id: string, stat: { mtime_ms: number; size: number }) => void;
  __memopadTestActiveDirty?: () => boolean;
  __memopadTestExternalChange?: () => boolean;
  __memopadTestRestoreSplit?: (input: {
    splitActive: boolean;
    secondaryId: string | null;
    focusedPane: 'primary' | 'secondary';
    secondaryPaneState: Array<{ bufferId: string; cursor: number | null; scrollTop: number | null }>;
  }) => void;
  __memopadTestSplitState?: () => {
    splitActive: boolean;
    secondaryId: string | null;
    focusedPane: 'primary' | 'secondary';
  };
  __memopadTestEditorPrefs?: () => { wordWrap: boolean; indentGuides: boolean; minimap: boolean };
  __memopadTestResetEditorPrefs?: () => void;
  __memopadTestCursorPos?: () => { line: number; col: number };
  __memopadTestRecentFiles?: () => string[];
  __memopadTestResetRecentFiles?: () => void;
};

w.__memopadTestSetContent = (s) => useBuffers.getState().setActiveContent(s);
w.__memopadTestGetContent = () => selectActive(useBuffers.getState())?.content ?? '';
w.__memopadTestReset = () => useBuffers.getState().resetAll();
w.__memopadTestNewBuffer = () => useBuffers.getState().newBuffer();
w.__memopadTestOpenBuffer = (file) => useBuffers.getState().openBuffer(file);
w.__memopadTestCloseBuffer = (id) => useBuffers.getState().closeBuffer(id);
w.__memopadTestSwitchTo = (id) => useBuffers.getState().switchTo(id);
w.__memopadTestActiveId = () => useBuffers.getState().activeId;
w.__memopadTestGetActiveBufferPath = () => selectActive(useBuffers.getState())?.path ?? null;
w.__memopadTestTabIds = () => useBuffers.getState().buffers.map((b) => b.id);
w.__memopadTestSetExternalChange = (id, flag) =>
  useBuffers.getState().setExternalChange(id, flag);
w.__memopadTestRecordStat = (id, stat) =>
  useBuffers.getState().recordStat(id, stat);
w.__memopadTestActiveDirty = () => selectActive(useBuffers.getState())?.dirty ?? false;
w.__memopadTestExternalChange = () =>
  selectActive(useBuffers.getState())?.externalChange ?? false;
w.__memopadTestRestoreSplit = (input) => useBuffers.getState().restoreSplitState(input);
w.__memopadTestSplitState = () => {
  const s = useBuffers.getState();
  return { splitActive: s.splitActive, secondaryId: s.secondaryId, focusedPane: s.focusedPane };
};
w.__memopadTestEditorPrefs = () => ({
  wordWrap: useEditorPrefs.getState().wordWrap,
  indentGuides: useEditorPrefs.getState().indentGuides,
  minimap: useEditorPrefs.getState().minimap,
});
w.__memopadTestResetEditorPrefs = () => useEditorPrefs.getState().reset();
w.__memopadTestCursorPos = () => ({
  line: useCursorPos.getState().line,
  col: useCursorPos.getState().col,
});
w.__memopadTestRecentFiles = () => useRecentFiles.getState().recentFiles;
w.__memopadTestResetRecentFiles = () => useRecentFiles.getState().clear();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
