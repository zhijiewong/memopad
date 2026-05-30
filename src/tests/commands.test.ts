import { describe, it, expect, beforeEach } from 'vitest';
import { useCommands, search } from '../commands/registry';
import { registerRecentFolderCommands, registerBuiltins } from '../commands/builtins';
import { useBuffers } from '../stores/buffers';

describe('command registry', () => {
  beforeEach(() => useCommands.getState().reset());

  it('starts empty', () => {
    expect(useCommands.getState().commands).to.deep.equal([]);
  });

  it('register adds a command', () => {
    let calls = 0;
    useCommands.getState().register({
      id: 'file.save',
      title: 'File: Save',
      run: () => { calls += 1; },
    });
    expect(useCommands.getState().commands).to.have.length(1);
    useCommands.getState().commands[0].run();
    expect(calls).to.equal(1);
  });

  it('register replaces a command with the same id', () => {
    useCommands.getState().register({ id: 'x', title: 'first', run: () => {} });
    useCommands.getState().register({ id: 'x', title: 'second', run: () => {} });
    expect(useCommands.getState().commands).to.have.length(1);
    expect(useCommands.getState().commands[0].title).to.equal('second');
  });

  it('search returns commands whose title fuzzy-matches the query', () => {
    useCommands.getState().register({ id: 'a', title: 'Open File', run: () => {} });
    useCommands.getState().register({ id: 'b', title: 'Save File', run: () => {} });
    useCommands.getState().register({ id: 'c', title: 'New Tab', run: () => {} });

    const r1 = search('ope').map((m) => m.command.id);
    expect(r1).to.include('a');
    expect(r1).to.not.include('c');

    const r2 = search('file').map((m) => m.command.id);
    expect(r2).to.include.members(['a', 'b']);
    expect(r2).to.not.include('c');
  });

  it('search with empty query returns all commands in recent-first order', () => {
    useCommands.getState().register({ id: 'a', title: 'A', run: () => {} });
    useCommands.getState().register({ id: 'b', title: 'B', run: () => {} });
    useCommands.getState().register({ id: 'c', title: 'C', run: () => {} });
    useCommands.getState().recordUsed('b');
    useCommands.getState().recordUsed('a');
    const ids = search('').map((m) => m.command.id);
    expect(ids[0]).to.equal('a');
    expect(ids[1]).to.equal('b');
    // c (never used) comes after the recent ones; order among never-used items is registration order.
    expect(ids[2]).to.equal('c');
  });
});

describe('registerRecentFolderCommands', () => {
  it('replaces previous workspace.recent.* entries', () => {
    const initialCount = useCommands.getState().commands.length;
    // Pre-seed stale recent commands.
    useCommands.getState().register({ id: 'workspace.recent.0', title: 'Old', run: () => {} });
    useCommands.getState().register({ id: 'workspace.recent.1', title: 'Older', run: () => {} });

    registerRecentFolderCommands(['C:/proj/foo', 'C:/proj/bar']);

    const final = useCommands.getState().commands;
    const recents = final.filter((c) => c.id.startsWith('workspace.recent.'));
    expect(recents.length).toBe(2);
    expect(recents.map((r) => r.title).sort()).toEqual(['Open Recent: bar', 'Open Recent: foo']);
    // Non-recent commands intact:
    expect(final.length).toBeGreaterThanOrEqual(initialCount);
  });
});

describe('pane focus commands', () => {
  beforeEach(() => {
    useCommands.getState().reset();
    useBuffers.getState().resetAll();
    registerBuiltins();
  });

  function run(id: string) {
    const cmd = useCommands.getState().commands.find((c) => c.id === id);
    if (!cmd) throw new Error(`command ${id} not registered`);
    cmd.run();
  }

  it('focusPrimaryPane and focusSecondaryPane round-trip when split is active', () => {
    useBuffers.getState().openBuffer({ path: '/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' });
    useBuffers.getState().toggleSplit();          // focusedPane becomes 'secondary'
    run('view.focusPrimaryPane');
    expect(useBuffers.getState().focusedPane).toBe('primary');
    run('view.focusSecondaryPane');
    expect(useBuffers.getState().focusedPane).toBe('secondary');
  });

  it('view.focusSecondaryPane is a no-op when not split', () => {
    useBuffers.getState().openBuffer({ path: '/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' });
    run('view.focusSecondaryPane');
    expect(useBuffers.getState().focusedPane).toBe('primary'); // secondary focus rejected when not split
    run('view.focusPrimaryPane');
    expect(useBuffers.getState().focusedPane).toBe('primary'); // primary focus always valid
  });
});
