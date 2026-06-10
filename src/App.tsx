import { useEffect, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { UpdateBanner } from './components/UpdateBanner';
import { Editor } from './components/Editor';
import { CommandPalette } from './components/CommandPalette';
import { QuickOpenPalette } from './components/QuickOpenPalette';
import { GoToLineDialog } from './components/GoToLineDialog';
import { StatusBar } from './components/StatusBar';
import { Sidebar } from './components/Sidebar';
import { useCommands } from './commands/registry';
import { registerBuiltins, registerRecentFolderCommands, registerRecentFileCommands } from './commands/builtins';
import { useBuffers, selectFocused } from './stores/buffers';
import { useTheme, effectiveTheme } from './stores/theme';
import { useWorkspace } from './stores/workspace';
import { useRecentFiles } from './stores/recentFiles';
import { useEditorPrefs } from './stores/editorPrefs';
import { startJournalDebounce } from './lib/journal-debounce';
import { startFsWatcher, stopFsWatcher, checkWatcherAlive } from './lib/fs-watcher';
import { bootRestore } from './lib/boot';
import { statFile, sessionSaveWindow, sessionSaveApp } from './lib/tauri';
import { currentWindowSession } from './lib/window-session';
import { getCurrentWindow } from '@tauri-apps/api/window';

registerBuiltins();

const winLabel = getCurrentWindow().label;

function runCommand(id: string) {
  const cmd = useCommands.getState().commands.find((c) => c.id === id);
  if (!cmd) return;
  useCommands.getState().recordUsed(id);
  cmd.run();
}

function persistWindow(label: string) {
  sessionSaveWindow(currentWindowSession(label)).catch(() => {});
}

function persistApp() {
  sessionSaveApp(
    {
      word_wrap: useEditorPrefs.getState().wordWrap,
      indent_guides: useEditorPrefs.getState().indentGuides,
      minimap: useEditorPrefs.getState().minimap,
      code_folding: useEditorPrefs.getState().codeFolding,
    },
    useWorkspace.getState().recentFolders,
    useRecentFiles.getState().recentFiles,
  ).catch(() => {});
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
  const [gotoLineOpen, setGotoLineOpen] = useState(false);

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
        registerRecentFileCommands(useRecentFiles.getState().recentFiles);
      })
      .catch((err) => console.error('boot failed:', err));

    const stopJournal = startJournalDebounce();
    const stopSessionWatcher = useBuffers.subscribe(() => {
      persistWindow(winLabel);
      recordStatsForBuffersWithoutOne().catch(() => {});
    });
    // Workspace folder is per-window; the recent-folders list is app-global, so
    // a workspace change must update both slices.
    const stopWorkspaceWatcher = useWorkspace.subscribe(() => {
      persistWindow(winLabel);
      persistApp();
    });
    const stopEditorPrefsWatcher = useEditorPrefs.subscribe(() => {
      persistApp();
    });
    const stopRecentWatcher = useWorkspace.subscribe((state, prev) => {
      if (state.recentFolders !== prev.recentFolders) {
        registerRecentFolderCommands(state.recentFolders);
      }
    });
    const stopRecentFilesWatcher = useRecentFiles.subscribe((state, prev) => {
      if (state.recentFiles !== prev.recentFiles) {
        registerRecentFileCommands(state.recentFiles);
        persistApp();
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
      if (focused) {
        rescanExternalChanges().catch(() => {});
        const folder = useWorkspace.getState().workspaceFolder;
        if (folder) checkWatcherAlive(folder).catch(() => {});
      }
    });

    return () => {
      stopJournal();
      stopSessionWatcher();
      stopWorkspaceWatcher();
      stopRecentWatcher();
      stopRecentFilesWatcher();
      stopWatcherSync();
      stopEditorPrefsWatcher();
      stopFsWatcher().catch(() => {});
      unlistenFocusP.then((un) => un()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    (window as unknown as { __memopadToggleSidebar?: () => void }).__memopadToggleSidebar = () => setSidebarOpen((v) => !v);
    (window as unknown as { __memopadOpenSidebarAndFocusFind?: () => void }).__memopadOpenSidebarAndFocusFind = () => {
      setSidebarOpen(true);
      // Switch to the search tab; the sidebar defaults to the file-tree tab, so
      // without this the SearchPanel never mounts and find-in-files is unreachable.
      (window as unknown as { __memopadShowSearchPanel?: () => void }).__memopadShowSearchPanel?.();
      // Let the SearchPanel mount (and register its focus hook) before focusing.
      requestAnimationFrame(() => {
        (window as unknown as { __memopadFocusFindInFiles?: () => void }).__memopadFocusFindInFiles?.();
      });
    };
    (window as unknown as { __memopadOpenPaletteWithQuery?: (q: string) => void }).__memopadOpenPaletteWithQuery = (q: string) => {
      setPresetQuery(q);
      setPaletteOpen(true);
    };
    (window as unknown as { __memopadShowQuickOpen?: () => void }).__memopadShowQuickOpen = () => setQuickOpenShown(true);
    (window as unknown as { __memopadOpenGotoLine?: () => void }).__memopadOpenGotoLine = () => {
      if (selectFocused(useBuffers.getState())) setGotoLineOpen(true);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      // Alt+Z toggles word wrap (no Ctrl/Meta — handle before the mod guard).
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        runCommand('view.toggleWordWrap');
        return;
      }
      if (!mod) return;
      const key = e.key.toLowerCase();

      if (key === 'n' && e.shiftKey) { e.preventDefault(); runCommand('window.new'); return; }
      if (key === 'q' && !e.shiftKey) { e.preventDefault(); runCommand('app.quit'); return; }
      if (key === 'g' && !e.shiftKey) {
        e.preventDefault();
        (window as unknown as { __memopadOpenGotoLine?: () => void }).__memopadOpenGotoLine?.();
        return;
      }
      if (key === 'b' && !e.shiftKey) { e.preventDefault(); setSidebarOpen((v) => !v); return; }
      if (key === '1' && !e.shiftKey) { e.preventDefault(); runCommand('view.focusPrimaryPane'); return; }
      if (key === '2' && !e.shiftKey) { e.preventDefault(); runCommand('view.focusSecondaryPane'); return; }
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
      if (key === 'e' && !e.shiftKey) { e.preventDefault(); runCommand('file.openRecent'); return; }
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
      {gotoLineOpen && (
        <GoToLineDialog onClose={() => setGotoLineOpen(false)} />
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
