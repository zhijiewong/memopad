import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { useBuffers, selectActive } from './stores/buffers';

// E2E test hooks. Read-only or trivial write-only shims so WebDriver tests can
// drive the store without going through CodeMirror keystroke timing.
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
  __memopadTestTabIds?: () => string[];
};

w.__memopadTestSetContent = (s) => useBuffers.getState().setActiveContent(s);
w.__memopadTestGetContent = () => selectActive(useBuffers.getState())?.content ?? '';
w.__memopadTestReset = () => useBuffers.getState().resetAll();
w.__memopadTestNewBuffer = () => useBuffers.getState().newBuffer();
w.__memopadTestOpenBuffer = (file) => useBuffers.getState().openBuffer(file);
w.__memopadTestCloseBuffer = (id) => useBuffers.getState().closeBuffer(id);
w.__memopadTestSwitchTo = (id) => useBuffers.getState().switchTo(id);
w.__memopadTestActiveId = () => useBuffers.getState().activeId;
w.__memopadTestTabIds = () => useBuffers.getState().buffers.map((b) => b.id);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
