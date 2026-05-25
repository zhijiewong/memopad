import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Editor } from './components/Editor';
import { useBuffer } from './stores/buffer';
import { openFile, saveFile } from './lib/tauri';
import { pickFileToOpen, pickFileToSave } from './lib/dialog';

async function doSave(saveAs: boolean) {
  const s = useBuffer.getState();
  let path = s.path;
  if (!path || saveAs) {
    const picked = await pickFileToSave(path);
    if (!picked) return;
    path = picked;
  }
  try {
    await saveFile(path, s.content, s.encoding, s.eol);
    useBuffer.getState().markSaved(path);
  } catch (err) {
    console.error('save failed:', err);
  }
}

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
        return;
      }

      if (key === 's' && !e.shiftKey) {
        e.preventDefault();
        await doSave(false);
        return;
      }

      if (key === 's' && e.shiftKey) {
        e.preventDefault();
        await doSave(true);
        return;
      }

      if (key === 'n' && !e.shiftKey) {
        e.preventDefault();
        // Discard current buffer for now. Phase 3 introduces multi-buffer tabs
        // and a "save before close?" prompt; in Phase 2 we trust the user
        // (they can see the dirty indicator).
        useBuffer.getState().reset();
        return;
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
