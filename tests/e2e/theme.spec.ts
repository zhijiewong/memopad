import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('theme', () => {
  it('html element has theme-dark or theme-light class', async () => {
    const cls = await classicExecute<string>(
      `return document.documentElement.className;`,
    );
    expect(cls).to.match(/theme-(dark|light)/);
  });

  it('palette command "View: Use Light Theme" switches to theme-light', async () => {
    await getBrowser().execute(() => {
      (window as unknown as { __memopadTestRunCommand: (id: string) => void }).__memopadTestRunCommand('theme.light');
    });
    await sleep(200);
    const cls = await classicExecute<string>(
      `return document.documentElement.className;`,
    );
    expect(cls).to.include('theme-light');
    expect(cls).to.not.include('theme-dark');
  });

  it('palette command "View: Use Dark Theme" switches to theme-dark', async () => {
    await getBrowser().execute(() => {
      (window as unknown as { __memopadTestRunCommand: (id: string) => void }).__memopadTestRunCommand('theme.dark');
    });
    await sleep(200);
    const cls = await classicExecute<string>(
      `return document.documentElement.className;`,
    );
    expect(cls).to.include('theme-dark');
    expect(cls).to.not.include('theme-light');
  });
});
