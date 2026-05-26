import { create } from 'zustand';
import fuzzysort from 'fuzzysort';

export interface Command {
  id: string;
  title: string;
  shortcut?: string;
  run: () => void | Promise<void>;
}

export interface SearchMatch {
  command: Command;
  score: number;
}

interface CommandsState {
  commands: Command[];
  /** Most-recent-first list of command ids that were run. */
  recent: string[];
  register: (cmd: Command) => void;
  unregister: (id: string) => void;
  recordUsed: (id: string) => void;
  reset: () => void;
}

const RECENT_CAP = 20;

export const useCommands = create<CommandsState>((set) => ({
  commands: [],
  recent: [],
  register: (cmd) =>
    set((s) => {
      const without = s.commands.filter((c) => c.id !== cmd.id);
      return { commands: [...without, cmd] };
    }),
  unregister: (id) =>
    set((s) => ({ commands: s.commands.filter((c) => c.id !== id) })),
  recordUsed: (id) =>
    set((s) => ({ recent: [id, ...s.recent.filter((x) => x !== id)].slice(0, RECENT_CAP) })),
  reset: () => set({ commands: [], recent: [] }),
}));

export function search(query: string): SearchMatch[] {
  const { commands, recent } = useCommands.getState();
  if (!query) {
    const recentSet = new Set(recent);
    const recentMatches: SearchMatch[] = [];
    for (const id of recent) {
      const cmd = commands.find((c) => c.id === id);
      if (cmd) recentMatches.push({ command: cmd, score: 0 });
    }
    const others = commands
      .filter((c) => !recentSet.has(c.id))
      .map((c) => ({ command: c, score: 0 }));
    return [...recentMatches, ...others];
  }
  const results = fuzzysort.go(query, commands, { key: 'title', threshold: -1000 });
  return results.map((r) => ({ command: r.obj, score: r.score }));
}
