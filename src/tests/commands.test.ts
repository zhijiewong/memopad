import { describe, it, expect, beforeEach } from 'vitest';
import { useCommands, search } from '../commands/registry';

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
