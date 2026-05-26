import { useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Editor } from './components/Editor';
import { useBuffers, selectActive } from './stores/buffers';
import { openFile, saveFile } from './lib/tauri';
import { pickFileToOpen, pickFileToSave } from './lib/dialog';

async function doOpen() {
  const path = await pickFileToOpen();
  if (!path) return;
  try {
    const opened = await openFile(path);
    useBuffers.getState().openBuffer(opened);
  } catch (err) {
    console.error('open failed:', err);
  }
}

async function doSave(saveAs: boolean) {
  const active = selectActive(useBuffers.getState());
  if (!active) return;
  let path = active.path;
  if (!path || saveAs) {
    const picked = await pickFileToSave(path);
    if (!picked) return;
    path = picked;
  }
  try {
    await saveFile(path, active.content, active.encoding, active.eol);
    useBuffers.getState().markSaved(active.id, path);
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
        await doOpen();
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
        useBuffers.getState().newBuffer();
        return;
      }
      if (key === 'w' && !e.shiftKey) {
        e.preventDefault();
        const id = useBuffers.getState().activeId;
        if (id) useBuffers.getState().closeBuffer(id);
        return;
      }
      if (key === 't' && e.shiftKey) {
        e.preventDefault();
        useBuffers.getState().reopenLastClosed();
        return;
      }
      if (key === 'tab') {
        e.preventDefault();
        const { buffers, activeId } = useBuffers.getState();
        if (buffers.length < 2) return;
        const idx = buffers.findIndex((b) => b.id === activeId);
        const dir = e.shiftKey ? -1 : 1;
        const nextIdx = (idx + dir + buffers.length) % buffers.length;
        useBuffers.getState().switchTo(buffers[nextIdx].id);
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
