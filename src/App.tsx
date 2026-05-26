import { useEffect, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { Editor } from './components/Editor';
import { CommandPalette } from './components/CommandPalette';
import { StatusBar } from './components/StatusBar';
import { useCommands } from './commands/registry';
import { registerBuiltins } from './commands/builtins';

registerBuiltins();

function runCommand(id: string) {
  const cmd = useCommands.getState().commands.find((c) => c.id === id);
  if (!cmd) return;
  useCommands.getState().recordUsed(id);
  cmd.run();
}

export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      // Command palette
      if (key === 'k' && !e.shiftKey) {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (key === 'p' && e.shiftKey) {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }

      // File ops
      if (key === 'o' && !e.shiftKey) { e.preventDefault(); runCommand('file.open'); return; }
      if (key === 's' && !e.shiftKey) { e.preventDefault(); runCommand('file.save'); return; }
      if (key === 's' && e.shiftKey)  { e.preventDefault(); runCommand('file.saveAs'); return; }
      if (key === 'n' && !e.shiftKey) { e.preventDefault(); runCommand('file.new'); return; }

      // Tab ops
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

// expose runCommand for the e2e tests (used by palette.spec.ts)
(window as unknown as { __memopadTestRunCommand?: (id: string) => void }).__memopadTestRunCommand = runCommand;
