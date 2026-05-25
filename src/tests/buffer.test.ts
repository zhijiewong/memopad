import { describe, it, expect, beforeEach } from 'vitest';
import { useBuffer } from '../stores/buffer';

describe('buffer store', () => {
  beforeEach(() => {
    useBuffer.getState().reset();
  });

  it('starts empty and clean', () => {
    const s = useBuffer.getState();
    expect(s.path).toBeNull();
    expect(s.content).toBe('');
    expect(s.dirty).toBe(false);
    expect(s.encoding).toBe('utf-8');
    expect(s.eol).toBe('lf');
  });

  it('setContent dirties when content differs from original', () => {
    useBuffer.getState().setContent('hello');
    expect(useBuffer.getState().dirty).toBe(true);
  });

  it('setContent stays clean when content matches original', () => {
    useBuffer.getState().loadOpened({
      path: '/tmp/x.txt',
      content: 'hello',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffer.getState().setContent('hello');
    expect(useBuffer.getState().dirty).toBe(false);
  });

  it('loadOpened replaces buffer and marks clean', () => {
    useBuffer.getState().setContent('dirty stuff');
    useBuffer.getState().loadOpened({
      path: '/tmp/y.txt',
      content: 'fresh',
      encoding: 'utf-16-le',
      eol: 'crlf',
    });
    const s = useBuffer.getState();
    expect(s.path).toBe('/tmp/y.txt');
    expect(s.content).toBe('fresh');
    expect(s.encoding).toBe('utf-16-le');
    expect(s.eol).toBe('crlf');
    expect(s.dirty).toBe(false);
  });

  it('markSaved resets dirty without touching content', () => {
    useBuffer.getState().loadOpened({
      path: '/tmp/z.txt',
      content: 'a',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffer.getState().setContent('b');
    expect(useBuffer.getState().dirty).toBe(true);
    useBuffer.getState().markSaved('/tmp/z.txt');
    const s = useBuffer.getState();
    expect(s.dirty).toBe(false);
    expect(s.content).toBe('b');
    expect(s.path).toBe('/tmp/z.txt');
  });

  it('reset returns to the initial empty state', () => {
    useBuffer.getState().loadOpened({
      path: '/x',
      content: 'y',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffer.getState().reset();
    const s = useBuffer.getState();
    expect(s.path).toBeNull();
    expect(s.content).toBe('');
    expect(s.dirty).toBe(false);
  });
});
