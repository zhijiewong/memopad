import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

describe('command palette', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      (window as unknown as { __memopadTestReset: () => void }).__memopadTestReset();
    });
  });

  it('opens with Ctrl+K and lists at least one command', async () => {
    await getBrowser().keys(['Control', 'k']);
    // give the modal a moment to mount
    await new Promise((r) => setTimeout(r, 250));
    const items = await classicExecute<string[]>(
      `return Array.from(document.querySelectorAll('[role="option"]')).map(el => el.textContent || '');`,
    );
    expect(items.length).to.be.greaterThan(0);
    expect(items.some((t) => t.includes('File: Open'))).to.equal(true);
    // close it
    await getBrowser().keys('Escape');
  });

  it('filters as you type', async () => {
    await getBrowser().keys(['Control', 'k']);
    await new Promise((r) => setTimeout(r, 250));
    await getBrowser().keys('reveal');
    await new Promise((r) => setTimeout(r, 150));
    const items = await classicExecute<string[]>(
      `return Array.from(document.querySelectorAll('[role="option"]')).map(el => el.textContent || '');`,
    );
    expect(items.length).to.be.greaterThan(0);
    expect(items.every((t) => t.toLowerCase().includes('reveal'))).to.equal(true);
    await getBrowser().keys('Escape');
  });

  it('runCommand bypass — file.new creates a new untitled tab', async () => {
    await exec(() => {
      (window as unknown as { __memopadTestRunCommand: (id: string) => void }).__memopadTestRunCommand('file.new');
    });
    const count = await exec(() => {
      const f = (window as unknown as { __memopadTestTabIds: () => string[] }).__memopadTestTabIds;
      return f().length;
    });
    expect(count).to.equal(1);
  });
});
