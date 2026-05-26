import { describe, it, expect, beforeEach } from 'vitest';
import { useBuffers } from '../stores/buffers';

describe('buffers store', () => {
  beforeEach(() => {
    useBuffers.getState().resetAll();
  });

  it('starts with no buffers and null active', () => {
    const s = useBuffers.getState();
    expect(s.buffers).to.deep.equal([]);
    expect(s.activeId).to.equal(null);
    expect(s.recentlyClosed).to.deep.equal([]);
  });

  it('newBuffer creates an Untitled buffer, makes it active, and returns its id', () => {
    const id = useBuffers.getState().newBuffer();
    const s = useBuffers.getState();
    expect(s.buffers).to.have.length(1);
    expect(s.activeId).to.equal(id);
    expect(s.buffers[0].path).to.equal(null);
    expect(s.buffers[0].content).to.equal('');
    expect(s.buffers[0].dirty).to.equal(false);
    expect(s.buffers[0].encoding).to.equal('utf-8');
    expect(s.buffers[0].eol).to.equal('lf');
  });

  it('openBuffer adds a buffer with file content + makes it active', () => {
    const id = useBuffers.getState().openBuffer({
      path: '/tmp/x.txt',
      content: 'hi',
      encoding: 'utf-8',
      eol: 'lf',
    });
    const s = useBuffers.getState();
    expect(s.buffers).to.have.length(1);
    expect(s.activeId).to.equal(id);
    expect(s.buffers[0].content).to.equal('hi');
    expect(s.buffers[0].dirty).to.equal(false);
  });

  it('opening the same path twice switches to the existing buffer (no duplicate)', () => {
    const a = useBuffers.getState().openBuffer({
      path: '/tmp/x.txt',
      content: 'hi',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffers.getState().newBuffer(); // create a second tab
    const b = useBuffers.getState().openBuffer({
      path: '/tmp/x.txt',
      content: 'hi',
      encoding: 'utf-8',
      eol: 'lf',
    });
    const s = useBuffers.getState();
    expect(b).to.equal(a);
    expect(s.buffers).to.have.length(2); // original + the Untitled, not 3
    expect(s.activeId).to.equal(a);
  });

  it('setActiveContent dirties the active buffer only', () => {
    const a = useBuffers.getState().newBuffer();
    const b = useBuffers.getState().newBuffer(); // now active
    useBuffers.getState().setActiveContent('typed');
    const s = useBuffers.getState();
    expect(s.buffers.find((x) => x.id === b)!.dirty).to.equal(true);
    expect(s.buffers.find((x) => x.id === a)!.dirty).to.equal(false);
  });

  it('switchTo changes active without touching other state', () => {
    const a = useBuffers.getState().newBuffer();
    const b = useBuffers.getState().newBuffer();
    useBuffers.getState().setActiveContent('on b');
    useBuffers.getState().switchTo(a);
    expect(useBuffers.getState().activeId).to.equal(a);
    expect(useBuffers.getState().buffers.find((x) => x.id === b)!.content).to.equal('on b');
  });

  it('closeBuffer removes the buffer and pushes onto recentlyClosed', () => {
    const a = useBuffers.getState().openBuffer({
      path: '/tmp/x.txt',
      content: 'X',
      encoding: 'utf-8',
      eol: 'lf',
    });
    const b = useBuffers.getState().newBuffer();
    useBuffers.getState().closeBuffer(a);
    const s = useBuffers.getState();
    expect(s.buffers.map((x) => x.id)).to.deep.equal([b]);
    expect(s.activeId).to.equal(b);
    expect(s.recentlyClosed.map((x) => x.path)).to.deep.equal(['/tmp/x.txt']);
  });

  it('closing the active buffer focuses the next tab (or previous at end)', () => {
    const a = useBuffers.getState().newBuffer();
    const b = useBuffers.getState().newBuffer();
    const c = useBuffers.getState().newBuffer();
    // c is active. Closing c should focus b.
    useBuffers.getState().closeBuffer(c);
    expect(useBuffers.getState().activeId).to.equal(b);
    // Now b is active and at end (a, b). Closing b focuses a.
    useBuffers.getState().closeBuffer(b);
    expect(useBuffers.getState().activeId).to.equal(a);
    // Closing last buffer leaves activeId null.
    useBuffers.getState().closeBuffer(a);
    expect(useBuffers.getState().activeId).to.equal(null);
    expect(useBuffers.getState().buffers).to.deep.equal([]);
  });

  it('reopenLastClosed restores the most recently closed buffer', () => {
    const a = useBuffers.getState().openBuffer({
      path: '/tmp/x.txt',
      content: 'X',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffers.getState().closeBuffer(a);
    const restored = useBuffers.getState().reopenLastClosed();
    expect(restored).to.not.equal(null);
    const s = useBuffers.getState();
    expect(s.buffers).to.have.length(1);
    expect(s.buffers[0].path).to.equal('/tmp/x.txt');
    expect(s.activeId).to.equal(restored);
    expect(s.recentlyClosed).to.deep.equal([]);
  });

  it('reopenLastClosed returns null when stack is empty', () => {
    expect(useBuffers.getState().reopenLastClosed()).to.equal(null);
  });

  it('recentlyClosed is capped at 10', () => {
    for (let i = 0; i < 15; i++) {
      const id = useBuffers.getState().newBuffer();
      useBuffers.getState().closeBuffer(id);
    }
    expect(useBuffers.getState().recentlyClosed).to.have.length(10);
  });

  it('reorderBuffer moves a buffer to a new index', () => {
    const a = useBuffers.getState().newBuffer();
    const b = useBuffers.getState().newBuffer();
    const c = useBuffers.getState().newBuffer();
    useBuffers.getState().reorderBuffer(a, 2);
    expect(useBuffers.getState().buffers.map((x) => x.id)).to.deep.equal([b, c, a]);
  });

  it('markSaved clears dirty + updates path on the named buffer', () => {
    const a = useBuffers.getState().newBuffer();
    useBuffers.getState().setActiveContent('hello');
    expect(useBuffers.getState().buffers[0].dirty).to.equal(true);
    useBuffers.getState().markSaved(a, '/tmp/saved.txt');
    const s = useBuffers.getState();
    expect(s.buffers[0].path).to.equal('/tmp/saved.txt');
    expect(s.buffers[0].dirty).to.equal(false);
    expect(s.buffers[0].content).to.equal('hello');
  });
});
