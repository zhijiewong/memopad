import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('split view', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as { __memopadTestReset?: () => void };
      w.__memopadTestReset?.();
    });
    await sleep(150);
  });

  it('Ctrl+\\\\ opens two editor panes; pressing it again returns to one', async () => {
    await sleep(150);
    const before = await classicExecute<number>(
      `return document.querySelectorAll('[data-testid="editor-pane"]').length;`,
    );
    expect(before).to.equal(1);

    await getBrowser().keys(['Control', '\\']);
    await sleep(200);

    const splitPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="editor-split"]');`,
    );
    expect(splitPresent).to.equal(true);
    const afterSplit = await classicExecute<number>(
      `return document.querySelectorAll('[data-testid="editor-pane"]').length;`,
    );
    expect(afterSplit).to.equal(2);

    await getBrowser().keys(['Control', '\\']);
    await sleep(200);
    const afterCollapse = await classicExecute<number>(
      `return document.querySelectorAll('[data-testid="editor-pane"]').length;`,
    );
    expect(afterCollapse).to.equal(1);
  });
});
