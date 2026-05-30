import { useEffect, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { UpdateBanner } from './components/UpdateBanner';
import { Editor } from './components/Editor';
import { CommandPalette } from './components/CommandPalette';
import { QuickOpenPalette } from './components/QuickOpenPalette';
import { StatusBar } from './components/StatusBar';
import { Sidebar } from './components/Sidebar';
import { useCommands } from './commands/registry';
import { registerBuiltins, registerRecentFolderCommands } from './commands/builtins';
import { useBuffers } from './stores/buffers';
import { useTheme, effectiveTheme } from './stores/theme';
import { useWorkspace } from './stores/workspace';
import { startJournalDebounce } from './lib/journal-debounce';
import { startFsWatcher, stopFsWatcher } from './lib/fs-watcher';
import { bootRestore } from './lib/boot';
import { statFile } from './lib/tauri';
import { scheduleSessionSave } from './lib/session-debounce';
import { getCurrentWindow } from '@tauri-apps/api/window';

registerBuiltins();

function runCommand(id: string) {
  const cmd = useCommands.getState().commands.find((c) => c.id === id);
  if (!cmd) return;
  useCommands.getState().recordUsed(id);
  cmd.run();
}

function persistSession() {
  const state = useBuffers.getState();
  const folder = useWorkspace.getState().workspaceFolder;
  const recent = useWorkspace.getState().recentFolders;
  scheduleSessionSave({
    tabs: state.buffers.map((b) => ({ buffer_id: b.id, path: b.path })),
    active_id: state.activeId,
    workspace_folder: folder,
    recent_folders: recent,
  });
}

async function recordStatsForBuffersWithoutOne() {
  const state = useBuffers.getState();
  for (const b of state.buffers) {
    if (b.recordedStat || !b.path) continue;
    try {
      const stat = await statFile(b.path);
      useBuffers.getState().recordStat(b.id, stat);
    } catch { /* ignore */ }
  }
}

async function rescanExternalChanges() {
  const state = useBuffers.getState();
  for (const b of state.buffers) {
    if (!b.path) continue;
    try {
      const stat = await statFile(b.path);
      const prev = b.recordedStat;
      if (!prev) {
        useBuffers.getState().recordStat(b.id, stat);
        continue;
      }
      if (stat.mtime_ms !== prev.mtime_ms || stat.size !== prev.size) {
        useBuffers.getState().setExternalChange(b.id, true);
      }
    } catch {
      // File deleted under us — surface as external change too.
      useBuffers.getState().setExternalChange(b.id, true);
    }
  }
}

export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpenShown, setQuickOpenShown] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [presetQuery, setPresetQuery] = useState('');

  const themeMode = useTheme((s) => s.mode);
  useEffect(() => {
    const cls = effectiveTheme(themeMode) === 'dark' ? 'theme-dark' : 'theme-light';
    document.documentElement.classList.remove('theme-dark', 'theme-light');
    document.documentElement.classList.add(cls);
  }, [themeMode]);

  useEffect(() => {
    bootRestore()
      .then(() => recordStatsForBuffersWithoutOne())
      .then(() => {
        registerRecentFolderCommands(useWorkspace.getState().recentFolders);
      })
      .catch((err) => console.error('boot failed:', err));

    const stopJournal = startJournalDebounce();
    const stopSessionWatcher = useBuffers.subscribe(() => {
      persistSession();
      recordStatsForBuffersWithoutOne().catch(() => {});
    });
    const stopWorkspaceWatcher = useWorkspace.subscribe(() => {
      persistSession();
    });
    const stopRecentWatcher = useWorkspace.subscribe((state, prev) => {
      if (state.recentFolders !== prev.recentFolders) {
        registerRecentFolderCommands(state.recentFolders);
      }
    });
    const stopWatcherSync = useWorkspace.subscribe((state, prev) => {
      if (state.workspaceFolder !== prev.workspaceFolder) {
        if (state.workspaceFolder) {
          startFsWatcher(state.workspaceFolder).catch((err) =>
            console.warn('fs watcher start failed:', err)
          );
        } else {
          stopFsWatcher().catch(() => {});
        }
      }
    });
    // No onCloseRequested handler: the store subscription above already
    // persists session.json on every relevant state change, so by the time
    // the user clicks X the file is up to date. Registering a handler at
    // all interferes with the close path in Tauri 2 / WebView2 — the
    // window stays open until the handler is explicitly resolved. We use
    // window.destroy() on the Rust side to make X reliably close the app.
    const unlistenFocusP = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) rescanExternalChanges().catch(() => {});
    });

    return () => {
      stopJournal();
      stopSessionWatcher();
      stopWorkspaceWatcher();
      stopRecentWatcher();
      stopWatcherSync();
      stopFsWatcher().catch(() => {});
      unlistenFocusP.then((un) => un()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    (window as unknown as { __memopadToggleSidebar?: () => void }).__memopadToggleSidebar = () => setSidebarOpen((v) => !v);
    (window as unknown as { __memopadOpenSidebarAndFocusFind?: () => void }).__memopadOpenSidebarAndFocusFind = () => {
      setSidebarOpen(true);
      requestAnimationFrame(() => {
        (window as unknown as { __memopadFocusFindInFiles?: () => void }).__memopadFocusFindInFiles?.();
      });
    };
    (window as unknown as { __memopadOpenPaletteWithQuery?: (q: string) => void }).__memopadOpenPaletteWithQuery = (q: string) => {
      setPresetQuery(q);
      setPaletteOpen(true);
    };
    (window as unknown as { __memopadShowQuickOpen?: () => void }).__memopadShowQuickOpen = () => setQuickOpenShown(true);
  }, []);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      if (key === 'b' && !e.shiftKey) { e.preventDefault(); setSidebarOpen((v) => !v); return; }
      // Match the physical backslash key (e.code) as well as the produced
      // character (e.key). On non-US keyboard layouts the backslash key emits
      // a different e.key, so keying only off e.key silently breaks Ctrl+\.
      if ((key === '\\' || e.code === 'Backslash') && !e.shiftKey) {
        e.preventDefault();
        runCommand('view.toggleSplit');
        return;
      }
      if (key === 'r' && !e.shiftKey) {
        e.preventDefault();
        runCommand('workspace.openRecent');
        return;
      }
      if (key === 'e' && e.shiftKey) {
        e.preventDefault();
        (window as unknown as { __memopadToggleSidebarTab?: () => void }).__memopadToggleSidebarTab?.();
        return;
      }
      if (key === 'f' && e.shiftKey)  { e.preventDefault(); (window as unknown as { __memopadOpenSidebarAndFocusFind?: () => void }).__memopadOpenSidebarAndFocusFind?.(); return; }
      if (key === 'f' && !e.shiftKey) {
        e.preventDefault();
        globalThis.__memopadSearchPanel?.open('find');
        return;
      }
      if (key === 'h' && !e.shiftKey) {
        e.preventDefault();
        globalThis.__memopadSearchPanel?.open('replace');
        return;
      }
      if (key === 'k' && !e.shiftKey) { e.preventDefault(); setPaletteOpen(true); return; }
      if (key === 'p' && !e.shiftKey) {
        e.preventDefault();
        runCommand('quickOpen.show');
        return;
      }
      if (key === 'p' && e.shiftKey)  { e.preventDefault(); setPaletteOpen(true); return; }
      if (key === 'o' && !e.shiftKey) { e.preventDefault(); runCommand('file.open'); return; }
      if (key === 's' && !e.shiftKey) { e.preventDefault(); runCommand('file.save'); return; }
      if (key === 's' && e.shiftKey)  { e.preventDefault(); runCommand('file.saveAs'); return; }
      if (key === 'n' && !e.shiftKey) { e.preventDefault(); runCommand('file.new'); return; }
      if (key === 'w' && !e.shiftKey) { e.preventDefault(); runCommand('tab.close'); return; }
      if (key === 't' && e.shiftKey)  { e.preventDefault(); runCommand('tab.reopen'); return; }
      if (key === 'tab' && !e.shiftKey) { e.preventDefault(); runCommand('tab.next'); return; }
      if (key === 'tab' && e.shiftKey)  { e.preventDefault(); runCommand('tab.prev'); return; }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <TitleBar />
      <UpdateBanner />
      <main className="flex flex-1 overflow-hidden">
        <Sidebar
          open={sidebarOpen}
          onOpenFolder={() => runCommand('workspace.openFolder')}
        />
        <div className="flex flex-1 w-full">
          <Editor />
        </div>
      </main>
      <StatusBar />
      {paletteOpen && (
        <CommandPalette
          onClose={() => { setPaletteOpen(false); setPresetQuery(''); }}
          onRun={runCommand}
          initialQuery={presetQuery}
        />
      )}
      {quickOpenShown && (
        <QuickOpenPalette onClose={() => setQuickOpenShown(false)} />
      )}
    </div>
  );
}

(window as unknown as { __memopadTestRunCommand?: (id: string) => void }).__memopadTestRunCommand = runCommand;
(window as unknown as { __memopadTestSetWorkspace?: (folder: string) => void }).__memopadTestSetWorkspace = (folder: string) => {
  useWorkspace.getState().setFolder(folder);
};
(window as unknown as { __memopadTestPushRecent?: (folder: string) => void }).__memopadTestPushRecent = (folder: string) => {
  useWorkspace.getState().pushRecentFolder(folder);
};
