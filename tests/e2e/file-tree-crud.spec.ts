import { expect } from 'chai';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { getBrowser, classicExecute } from './support/driver';
import { pollFor, sleep } from './support/helpers';

const FIXTURE = path.resolve(__dirname, 'fixtures', 'workspace');

/** Does any tree row's text contain `text`? */
function rowHas(text: string): Promise<boolean> {
  return classicExecute<boolean>(
    `return Array.from(document.querySelectorAll('[data-testid="tree-row"]'))
       .some(r => (r.textContent || '').includes(${JSON.stringify(text)}));`,
  );
}

describe('file-tree CRUD', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadToggleSidebar?: () => void;
        __memopadShowFilesPanel?: () => void;
        __memopadTestSetWorkspace?: (folder: string | null) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestSetWorkspace?.(null as unknown as string);
      // Deterministically open the sidebar + Files tab so the panel (and its
      // __memopadTree* hooks) are mounted regardless of the prior spec's state.
      const open = !!document.querySelector('[data-testid="sidebar"]');
      if (!open) w.__memopadToggleSidebar?.();
      w.__memopadShowFilesPanel?.();
    });
    await sleep(200);
  });

  it('creates, renames, and deletes a file via the tree', async () => {
    // Idempotency: clear any residue from a previous interrupted run.
    for (const name of ['crud-tmp.txt', 'crud-renamed.txt']) {
      try { fs.rmSync(path.join(FIXTURE, name), { force: true }); } catch { /* ignore */ }
    }

    // Open the workspace; the panel auto-loads the root subtree.
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );
    expect(await pollFor(() => rowHas('notes.txt')), 'workspace tree should load').to.equal(true);

    // Create a file at the workspace root.
    await classicExecute<string>(
      `window.__memopadTreeCreate(${JSON.stringify(FIXTURE)}, 'crud-tmp.txt', false); return 'fired';`,
    );
    expect(await pollFor(() => rowHas('crud-tmp.txt')), 'created file should appear').to.equal(true);

    // Rename it — the tree row updates to the new name.
    const createdPath = path.join(FIXTURE, 'crud-tmp.txt');
    await classicExecute<string>(
      `window.__memopadTreeRename(${JSON.stringify(createdPath)}, 'crud-renamed.txt'); return 'fired';`,
    );
    expect(await pollFor(() => rowHas('crud-renamed.txt')), 'renamed file should appear').to.equal(true);
    expect(await rowHas('crud-tmp.txt'), 'old name should be gone').to.equal(false);

    // Delete (to Recycle Bin) and confirm it leaves the tree.
    const renamedPath = path.join(FIXTURE, 'crud-renamed.txt');
    await classicExecute<string>(
      `window.__memopadTreeDelete(${JSON.stringify(renamedPath)}); return 'fired';`,
    );
    expect(
      await pollFor(async () => !(await rowHas('crud-renamed.txt'))),
      'deleted file should be gone from the tree',
    ).to.equal(true);
  });
});
