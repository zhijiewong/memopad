import { describe, it, expect, beforeEach } from 'vitest';
import { useRecentFiles } from '../stores/recentFiles';
import { useBuffers } from '../stores/buffers';

describe('useRecentFiles', () => {
  beforeEach(() => useRecentFiles.getState().clear());

  it('push prepends MRU and dedupes case-insensitively', () => {
    useRecentFiles.getState().push('C:/proj/a.txt');
    useRecentFiles.getState().push('C:/proj/b.txt');
    useRecentFiles.getState().push('C:\\proj\\A.TXT'); // same as a.txt
    expect(useRecentFiles.getState().recentFiles[0]).toBe('C:\\proj\\A.TXT');
    expect(useRecentFiles.getState().recentFiles.filter((p) => p.toLowerCase().includes('a.txt')).length).toBe(1);
    expect(useRecentFiles.getState().recentFiles).toEqual(['C:\\proj\\A.TXT', 'C:/proj/b.txt']);
  });

  it('caps at 15', () => {
    for (let i = 0; i < 20; i++) useRecentFiles.getState().push(`C:/p/f${i}.txt`);
    expect(useRecentFiles.getState().recentFiles.length).toBe(15);
    expect(useRecentFiles.getState().recentFiles[0]).toBe('C:/p/f19.txt');
  });

  it('remove deletes by normalized path; clear empties', () => {
    useRecentFiles.getState().push('C:/proj/a.txt');
    useRecentFiles.getState().push('C:/proj/b.txt');
    useRecentFiles.getState().remove('c:\\proj\\a.txt');
    expect(useRecentFiles.getState().recentFiles).toEqual(['C:/proj/b.txt']);
    useRecentFiles.getState().clear();
    expect(useRecentFiles.getState().recentFiles).toEqual([]);
  });

  it('setRecent replaces and caps', () => {
    useRecentFiles.getState().setRecent(Array.from({ length: 20 }, (_, i) => `f${i}`));
    expect(useRecentFiles.getState().recentFiles.length).toBe(15);
  });
});

describe('openBuffer pushes recent files', () => {
  beforeEach(() => { useRecentFiles.getState().clear(); useBuffers.getState().resetAll(); });

  it('records opened paths MRU', () => {
    useBuffers.getState().openBuffer({ path: 'C:/proj/a.txt', content: '', encoding: 'utf-8', eol: 'lf' });
    useBuffers.getState().openBuffer({ path: 'C:/proj/b.txt', content: '', encoding: 'utf-8', eol: 'lf' });
    expect(useRecentFiles.getState().recentFiles).toEqual(['C:/proj/b.txt', 'C:/proj/a.txt']);
  });
});
