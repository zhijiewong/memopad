import { useBuffers, selectActive } from '../stores/buffers';
import { openFile, saveFile, revealInExplorer } from '../lib/tauri';
import { pickFileToOpen, pickFileToSave } from '../lib/dialog';
import { useCommands } from './registry';
import { useTheme } from '../stores/theme';

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

export function registerRecentFolderCommands(paths: string[]) {
  const { commands, register, unregister } = useCommands.getState();
  // Unregister previous dynamic recents.
  for (const c of commands) {
    if (c.id.startsWith('workspace.recent.')) unregister(c.id);
  }
  // Register fresh ones.
  paths.forEach((p, i) => {
    const basename = p.split(/[/\\]/).filter(Boolean).pop() ?? p;
    register({
      id: `workspace.recent.${i}`,
      title: `Open Recent: ${basename}`,
      run: async () => {
        const { useWorkspace } = await import('../stores/workspace');
        const { statFile } = await import('../lib/tauri');
        try {
          await statFile(p);
        } catch {
          useWorkspace.getState().removeRecentFolder(p);
          console.warn(`Recent folder no longer exists: ${p}`);
          return;
        }
        useWorkspace.getState().setFolder(p);
        useWorkspace.getState().pushRecentFolder(p);
      },
    });
  });
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

  register({
    id: 'theme.toggle',
    title: 'View: Toggle Theme (Dark / Light / System)',
    run: () => useTheme.getState().toggle(),
  });
  register({
    id: 'theme.dark',
    title: 'View: Use Dark Theme',
    run: () => useTheme.getState().set('dark'),
  });
  register({
    id: 'theme.light',
    title: 'View: Use Light Theme',
    run: () => useTheme.getState().set('light'),
  });
  register({
    id: 'theme.system',
    title: 'View: Use System Theme',
    run: () => useTheme.getState().set('system'),
  });

  register({
    id: 'edit.find',
    title: 'Edit: Find',
    shortcut: 'Ctrl+F',
    run: () => globalThis.__memopadSearchPanel?.open('find'),
  });
  register({
    id: 'edit.replace',
    title: 'Edit: Replace',
    shortcut: 'Ctrl+H',
    run: () => globalThis.__memopadSearchPanel?.open('replace'),
  });

  register({
    id: 'workspace.openFolder',
    title: 'Open Folder…',
    run: () => {
      import('../stores/workspace').then(({ useWorkspace }) => {
        useWorkspace.getState().openFolder().catch(() => {});
      });
    },
  });

  register({
    id: 'workspace.closeFolder',
    title: 'Close Folder',
    run: () => {
      import('../stores/workspace').then(({ useWorkspace }) => {
        useWorkspace.getState().closeFolder();
      });
    },
  });

  register({
    id: 'view.toggleSidebar',
    title: 'Toggle Sidebar',
    run: () => {
      (window as unknown as { __memopadToggleSidebar?: () => void }).__memopadToggleSidebar?.();
    },
  });

  register({
    id: 'search.focusFindInFiles',
    title: 'Find in Files',
    run: () => {
      (window as unknown as { __memopadOpenSidebarAndFocusFind?: () => void }).__memopadOpenSidebarAndFocusFind?.();
    },
  });

  register({
    id: 'view.toggleSidebarTab',
    title: 'Toggle Sidebar Tab (Files/Search)',
    run: () => {
      (window as unknown as { __memopadToggleSidebarTab?: () => void }).__memopadToggleSidebarTab?.();
    },
  });

  register({
    id: 'workspace.openRecent',
    title: 'Open Recent Folder…',
    shortcut: 'Ctrl+R',
    run: () => {
      (window as unknown as { __memopadOpenPaletteWithQuery?: (q: string) => void })
        .__memopadOpenPaletteWithQuery?.('Open Recent: ');
    },
  });
}
