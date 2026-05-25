import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { useBuffer } from './stores/buffer';

// E2E test hooks. Exposed on window so the WebDriver session can drive the
// buffer store directly without going through CodeMirror keystroke timing.
// These are read-only or trivially write-only shims — no business logic here.
const w = window as unknown as {
  __memopadTestSetContent?: (s: string) => void;
  __memopadTestGetContent?: () => string;
  __memopadTestReset?: () => void;
};
w.__memopadTestSetContent = (s) => useBuffer.getState().setContent(s);
w.__memopadTestGetContent = () => useBuffer.getState().content;
w.__memopadTestReset = () => useBuffer.getState().reset();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
