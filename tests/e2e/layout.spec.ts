import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

// These tests assert layout invariants that prevent silent UI regressions like
// the Phase-4 Editor wrapper collapsing to 28px wide.

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

interface Rect { x: number; y: number; width: number; height: number; right: number; bottom: number; }

async function rectOf(selector: string): Promise<Rect | null> {
  const result = await classicExecute<Rect | null>(
    `var el = document.querySelector(${JSON.stringify(selector)});
     if (!el) return null;
     var r = el.getBoundingClientRect();
     return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };`,
  );
  return result;
}

describe('layout invariants', () => {
  beforeEach(async () => {
    await exec(() => {
      const w = window as unknown as { __memopadTestReset: () => void };
      w.__memopadTestReset();
    });
  });

  it('title bar spans the window width and houses 4 buttons (menu + 3 controls)', async () => {
    const tb = await rectOf('.drag-region');
    expect(tb).to.not.equal(null);
    expect(tb!.width).to.be.greaterThan(800);
    expect(tb!.height).to.be.greaterThan(20).and.lessThan(60);
    expect(tb!.x).to.equal(0);
    expect(tb!.y).to.equal(0);

    const buttonCount = await classicExecute<number>(
      `return document.querySelectorAll('.drag-region button').length;`,
    );
    // ≡ menu + min + max + close = 4
    expect(buttonCount).to.equal(4);
  });

  it('close button is in the top-right and clickable', async () => {
    const closeBtn = await classicExecute<{ x: number; y: number; w: number; h: number; pointerEventsBlocked: boolean } | null>(
      `var btn = document.querySelector('.drag-region button[aria-label="Close"]');
       if (!btn) return null;
       var r = btn.getBoundingClientRect();
       // Walk up parents and verify no ancestor has pointer-events: none.
       var blocked = false;
       var el = btn;
       while (el && el !== document.documentElement) {
         var cs = getComputedStyle(el);
         if (cs.pointerEvents === 'none' || cs.visibility === 'hidden' || cs.display === 'none') {
           blocked = true; break;
         }
         el = el.parentElement;
       }
       return { x: r.x, y: r.y, w: r.width, h: r.height, pointerEventsBlocked: blocked };`,
    );
    expect(closeBtn).to.not.equal(null);
    expect(closeBtn!.w).to.be.greaterThan(20);
    expect(closeBtn!.h).to.be.greaterThan(20);
    // top-right corner
    const windowWidth = await classicExecute<number>(`return window.innerWidth;`);
    expect(closeBtn!.x).to.be.greaterThan(windowWidth - 100);
    expect(closeBtn!.y).to.be.lessThan(20);
    expect(closeBtn!.pointerEventsBlocked).to.equal(false);
  });

  it('with an active buffer, the editor fills the main area (catches the 28px regression)', async () => {
    await exec(() => {
      const w = window as unknown as { __memopadTestNewBuffer: () => string };
      w.__memopadTestNewBuffer();
    });
    // Wait a tick for CodeMirror to mount.
    await new Promise((r) => setTimeout(r, 300));
    const cm = await rectOf('.cm-editor');
    expect(cm, 'CodeMirror editor must render').to.not.equal(null);
    expect(cm!.width, 'editor must be more than 600px wide').to.be.greaterThan(600);
    expect(cm!.height, 'editor must be more than 200px tall').to.be.greaterThan(200);

    const mainRect = await rectOf('main');
    expect(mainRect).to.not.equal(null);
    // Editor's width must be within 50px of main's width (i.e. not collapsed)
    expect(Math.abs(cm!.width - mainRect!.width)).to.be.lessThan(50);
  });

  it('status bar is at the bottom of the window', async () => {
    await exec(() => {
      const w = window as unknown as { __memopadTestNewBuffer: () => string };
      w.__memopadTestNewBuffer();
    });
    const enc = await rectOf('[data-status-segment="encoding"]');
    expect(enc, 'encoding segment must render with an active buffer').to.not.equal(null);
    const windowHeight = await classicExecute<number>(`return window.innerHeight;`);
    // Status bar segment lives inside the bottom 30px of the window
    expect(enc!.y).to.be.greaterThan(windowHeight - 30);
  });

  it('vertical order top-to-bottom: title bar > main editor > status bar', async () => {
    await exec(() => {
      const w = window as unknown as { __memopadTestNewBuffer: () => string };
      w.__memopadTestNewBuffer();
    });
    await new Promise((r) => setTimeout(r, 200));
    const tb = await rectOf('.drag-region');
    const mainRect = await rectOf('main');
    const enc = await rectOf('[data-status-segment="encoding"]');
    expect(tb!.bottom).to.be.lessThanOrEqual(mainRect!.y);
    expect(mainRect!.bottom).to.be.lessThanOrEqual(enc!.y);
  });
});
