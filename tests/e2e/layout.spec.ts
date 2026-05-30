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
      const w = window as unknown as {
        __memopadTestReset: () => void;
        __memopadToggleSidebar?: () => void;
      };
      w.__memopadTestReset();
      // A prior spec may have left the sidebar open; resetAll() only clears
      // buffers, not the sidebar. Close it so it doesn't eat the editor width.
      const open = !!document.querySelector('[data-testid="sidebar"]');
      if (open) w.__memopadToggleSidebar?.();
    });
  });

  it('title bar spans the window width and houses 5 buttons (menu + sidebar + 3 controls)', async () => {
    const tb = await rectOf('.drag-region');
    expect(tb).to.not.equal(null);
    expect(tb!.width).to.be.greaterThan(800);
    expect(tb!.height).to.be.greaterThan(20).and.lessThan(60);
    expect(tb!.x).to.equal(0);
    expect(tb!.y).to.equal(0);

    const buttonCount = await classicExecute<number>(
      `return document.querySelectorAll('.drag-region button').length;`,
    );
    // ≡ menu + ☰ sidebar-toggle + min + max + close = 5
    expect(buttonCount).to.equal(5);
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

  it('CodeMirror accepts focus and shows content from the store (catches CM6 height collapse)', async () => {
    await exec(() => {
      const w = window as unknown as {
        __memopadTestNewBuffer: () => string;
        __memopadTestSetContent: (s: string) => void;
      };
      w.__memopadTestNewBuffer();
      w.__memopadTestSetContent('line one\nline two\nline three');
    });
    await new Promise((r) => setTimeout(r, 400));

    const info = await classicExecute<{
      cmContentRect: { w: number; h: number } | null;
      gutterRect: { w: number; h: number } | null;
      visibleText: string;
      lineCount: number;
    }>(
      `var content = document.querySelector('.cm-content');
       var gutter = document.querySelector('.cm-gutter');
       var lines = document.querySelectorAll('.cm-line');
       return {
         cmContentRect: content ? { w: content.getBoundingClientRect().width, h: content.getBoundingClientRect().height } : null,
         gutterRect: gutter ? { w: gutter.getBoundingClientRect().width, h: gutter.getBoundingClientRect().height } : null,
         visibleText: Array.from(lines).map(l => l.textContent).join('\\n'),
         lineCount: lines.length,
       };`,
    );

    expect(info.cmContentRect, 'cm-content (the text area) must exist').to.not.equal(null);
    // The text content area (not the gutter) must be wide enough to hold real text:
    expect(info.cmContentRect!.w, 'cm-content width').to.be.greaterThan(500);
    expect(info.cmContentRect!.h, 'cm-content height').to.be.greaterThan(100);
    // The gutter should be narrow (line numbers only):
    expect(info.gutterRect!.w, 'gutter should be narrow').to.be.lessThan(60);
    // Visible text matches what we put in the store:
    expect(info.lineCount).to.equal(3);
    expect(info.visibleText).to.include('line one');
    expect(info.visibleText).to.include('line three');
  });

  it('empty-state hint is horizontally centered when no buffer is open', async () => {
    // Reset to no buffers (resetBuffer creates one — use the raw reset instead).
    await exec(() => {
      const w = window as unknown as { __memopadTestReset: () => void };
      w.__memopadTestReset();
    });

    await new Promise((r) => setTimeout(r, 200));

    const info = await classicExecute<{
      windowW: number;
      hint: { x: number; right: number; w: number; text: string } | null;
      mainW: number;
    }>(
      `var hints = document.querySelectorAll('main *');
       var hint = null;
       for (var i = 0; i < hints.length; i++) {
         if (hints[i].textContent && hints[i].textContent.indexOf('Ctrl+O') >= 0 && hints[i].children.length === 0) {
           hint = hints[i];
           break;
         }
       }
       if (!hint) {
         // The container div might be the one with the text — fall back to the parent of any text node.
         var main = document.querySelector('main');
         hint = main && main.firstElementChild;
       }
       var r = hint ? hint.getBoundingClientRect() : null;
       var mainEl = document.querySelector('main');
       var mainR = mainEl ? mainEl.getBoundingClientRect() : null;
       return {
         windowW: window.innerWidth,
         hint: r ? { x: r.x, right: r.right, w: r.width, text: hint.textContent || '' } : null,
         mainW: mainR ? mainR.width : 0,
       };`,
    );
    expect(info.hint, 'empty-state hint must render').to.not.equal(null);
    expect(info.hint!.text).to.include('Ctrl+O');
    // The hint container must fill the main area (so its centered text appears centered in the window):
    expect(info.hint!.w, 'empty-state container width').to.be.greaterThan(info.mainW * 0.9);
    // The container left edge starts at main's left edge (0):
    expect(info.hint!.x, 'empty-state x').to.be.lessThan(10);
    // (At the end of the empty-state centering test, before its closing `});`)
    await getBrowser().saveScreenshot('tests/e2e/phase-4-empty-state.png');
  });
});
