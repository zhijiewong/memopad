import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Editor } from './components/Editor';
import { useBuffer } from './stores/buffer';
import { openFile } from './lib/tauri';
import { pickFileToOpen } from './lib/dialog';

export default function App() {
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      if (key === 'o' && !e.shiftKey) {
        e.preventDefault();
        const path = await pickFileToOpen();
        if (!path) return;
        try {
          const opened = await openFile(path);
          useBuffer.getState().loadOpened(opened);
        } catch (err) {
          console.error('open failed:', err);
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <TitleBar />
      <main className="flex flex-1 overflow-hidden">
        <Editor />
      </main>
    </div>
  );
}
