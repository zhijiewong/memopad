import { useEffect, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { Editor } from './components/Editor';
import { CommandPalette } from './components/CommandPalette';
import { StatusBar } from './components/StatusBar';
import { useCommands } from './commands/registry';
import { registerBuiltins } from './commands/builtins';
import { useBuffers } from './stores/buffers';
import { useTheme, effectiveTheme } from './stores/theme';
import { startJournalDebounce } from './lib/journal-debounce';
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
  scheduleSessionSave({
    tabs: state.buffers.map((b) => ({ buffer_id: b.id, path: b.path })),
    active_id: state.activeId,
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

  const themeMode = useTheme((s) => s.mode);
  useEffect(() => {
    const cls = effectiveTheme(themeMode) === 'dark' ? 'theme-dark' : 'theme-light';
    document.documentElement.classList.remove('theme-dark', 'theme-light');
    document.documentElement.classList.add(cls);
  }, [themeMode]);

  useEffect(() => {
    bootRestore()
      .then(() => recordStatsForBuffersWithoutOne())
      .catch((err) => console.error('boot failed:', err));

    const stopJournal = startJournalDebounce();
    const stopSessionWatcher = useBuffers.subscribe(() => {
      persistSession();
      recordStatsForBuffersWithoutOne().catch(() => {});
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
      unlistenFocusP.then((un) => un()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      if (key === 'k' && !e.shiftKey) { e.preventDefault(); setPaletteOpen(true); return; }
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
      <main className="flex flex-1 overflow-hidden">
        <Editor />
      </main>
      <StatusBar />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onRun={runCommand} />}
    </div>
  );
}

(window as unknown as { __memopadTestRunCommand?: (id: string) => void }).__memopadTestRunCommand = runCommand;
