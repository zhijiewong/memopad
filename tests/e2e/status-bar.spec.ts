import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

describe('status bar', () => {
  beforeEach(async () => {
    await exec(() => {
      const w = window as unknown as { __memopadTestReset: () => void };
      w.__memopadTestReset();
    });
  });

  it('shows nothing useful when no buffer is open', async () => {
    const txt = await classicExecute<string>(
      `var el = document.querySelector('[data-status-segment="encoding"]'); return el ? el.textContent : 'NONE';`,
    );
    expect(txt).to.equal('NONE');
  });

  it('shows UTF-8 / LF for a fresh untitled buffer', async () => {
    await exec(() => {
      const w = window as unknown as { __memopadTestNewBuffer: () => string };
      w.__memopadTestNewBuffer();
    });
    const enc = await classicExecute<string>(
      `return document.querySelector('[data-status-segment="encoding"]').textContent;`,
    );
    const eol = await classicExecute<string>(
      `return document.querySelector('[data-status-segment="eol"]').textContent;`,
    );
    expect(enc).to.equal('UTF-8');
    expect(eol).to.equal('LF');
  });

  it('reflects encoding from opened file', async () => {
    await exec(() => {
      const w = window as unknown as {
        __memopadTestOpenBuffer: (f: { path: string; content: string; encoding: string; eol: string }) => string;
      };
      w.__memopadTestOpenBuffer({ path: '/tmp/x.txt', content: 'hi', encoding: 'utf-16-le', eol: 'crlf' });
    });
    const enc = await classicExecute<string>(
      `return document.querySelector('[data-status-segment="encoding"]').textContent;`,
    );
    const eol = await classicExecute<string>(
      `return document.querySelector('[data-status-segment="eol"]').textContent;`,
    );
    expect(enc).to.equal('UTF-16 LE');
    expect(eol).to.equal('CRLF');
  });
});
