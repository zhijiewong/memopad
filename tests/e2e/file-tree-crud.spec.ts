import { expect } from 'chai';
import * as path from 'node:path';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const FIXTURE = path.resolve(__dirname, 'fixtures', 'workspace');

describe('file-tree CRUD', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadShowFilesPanel?: () => void;
        __memopadTestSetWorkspace?: (folder: string | null) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadShowFilesPanel?.();
      w.__memopadTestSetWorkspace?.(null as unknown as string);
    });
    await sleep(150);
  });

  it('creates, renames, and deletes a file via the tree', async () => {
    // Open the workspace + sidebar.
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );
    await sleep(400);

    // Create a file at the workspace root.
    await classicExecute<unknown>(
      `return window.__memopadTreeCreate(${JSON.stringify(FIXTURE)}, 'crud-tmp.txt', false);`,
    );
    await sleep(300);
    let hasFile = await classicExecute<boolean>(
      `return Array.from(document.querySelectorAll('[data-testid="tree-row"]'))
        .some(r => (r.textContent || '').includes('crud-tmp.txt'));`,
    );
    expect(hasFile, 'created file should appear in the tree').to.equal(true);

    // Open it, then rename — the open buffer's path should follow.
    const createdPath = path.join(FIXTURE, 'crud-tmp.txt');
    await classicExecute<unknown>(
      `var w = window;
       return (async () => {
         const opened = await w.__memopadOpenPathForTest
           ? w.__memopadOpenPathForTest(${JSON.stringify(createdPath)})
           : null;
         return opened;
       })();`,
    ).catch(() => undefined);
    await classicExecute<unknown>(
      `return window.__memopadTreeRename(${JSON.stringify(createdPath)}, 'crud-renamed.txt');`,
    );
    await sleep(300);
    const hasRenamed = await classicExecute<boolean>(
      `return Array.from(document.querySelectorAll('[data-testid="tree-row"]'))
        .some(r => (r.textContent || '').includes('crud-renamed.txt'));`,
    );
    expect(hasRenamed, 'renamed file should appear').to.equal(true);

    // Delete (to Recycle Bin) and confirm it leaves the tree.
    const renamedPath = path.join(FIXTURE, 'crud-renamed.txt');
    await classicExecute<unknown>(
      `return window.__memopadTreeDelete(${JSON.stringify(renamedPath)});`,
    );
    await sleep(400);
    hasFile = await classicExecute<boolean>(
      `return Array.from(document.querySelectorAll('[data-testid="tree-row"]'))
        .some(r => (r.textContent || '').includes('crud-renamed.txt'));`,
    );
    expect(hasFile, 'deleted file should be gone from the tree').to.equal(false);
  });
});
