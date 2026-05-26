import { useBuffers, selectActive } from '../stores/buffers';
import { openFile, saveFile, revealInExplorer } from '../lib/tauri';
import { pickFileToOpen, pickFileToSave } from '../lib/dialog';
import { useCommands } from './registry';

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

export function registerBuiltins() {
  const { register } = useCommands.getState();

  register({ id: 'file.new', title: 'File: New', shortcut: 'Ctrl+N', run: () => { useBuffers.getState().newBuffer(); } });
  register({ id: 'file.open', title: 'File: Open…', shortcut: 'Ctrl+O', run: doOpen });
  register({ id: 'file.save', title: 'File: Save', shortcut: 'Ctrl+S', run: () => doSave(false) });
  register({ id: 'file.saveAs', title: 'File: Save As…', shortcut: 'Ctrl+Shift+S', run: () => doSave(true) });

  register({
    id: 'tab.close',
    title: 'Tab: Close',
    shortcut: 'Ctrl+W',
    run: () => {
      const id = useBuffers.getState().activeId;
      if (id) useBuffers.getState().closeBuffer(id);
    },
  });
  register({
    id: 'tab.reopen',
    title: 'Tab: Reopen Closed',
    shortcut: 'Ctrl+Shift+T',
    run: () => { useBuffers.getState().reopenLastClosed(); },
  });
  register({
    id: 'tab.next',
    title: 'Tab: Next',
    shortcut: 'Ctrl+Tab',
    run: () => {
      const { buffers, activeId } = useBuffers.getState();
      if (buffers.length < 2) return;
      const idx = buffers.findIndex((b) => b.id === activeId);
      const next = (idx + 1) % buffers.length;
      useBuffers.getState().switchTo(buffers[next].id);
    },
  });
  register({
    id: 'tab.prev',
    title: 'Tab: Previous',
    shortcut: 'Ctrl+Shift+Tab',
    run: () => {
      const { buffers, activeId } = useBuffers.getState();
      if (buffers.length < 2) return;
      const idx = buffers.findIndex((b) => b.id === activeId);
      const prev = (idx - 1 + buffers.length) % buffers.length;
      useBuffers.getState().switchTo(buffers[prev].id);
    },
  });

  register({
    id: 'tab.copyPath',
    title: 'Tab: Copy Path',
    run: () => {
      const a = selectActive(useBuffers.getState());
      if (a?.path) navigator.clipboard.writeText(a.path).catch(() => {});
    },
  });
  register({
    id: 'tab.revealInExplorer',
    title: 'Tab: Reveal in Explorer',
    run: () => {
      const a = selectActive(useBuffers.getState());
      if (a?.path) revealInExplorer(a.path).catch(console.error);
    },
  });
}
