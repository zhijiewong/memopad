import { describe, it, expect } from 'vitest';
import { relativeToWorkspace } from '../lib/path';

describe('relativeToWorkspace', () => {
  it('strips workspace prefix', () => {
    expect(relativeToWorkspace('C:/proj/src/a.rs', 'C:/proj')).toBe('src/a.rs');
  });

  it('handles trailing separator in workspace', () => {
    expect(relativeToWorkspace('C:/proj/src/a.rs', 'C:/proj/')).toBe('src/a.rs');
  });

  it('is case-insensitive on Windows-style paths', () => {
    expect(relativeToWorkspace('C:/PROJ/src/a.rs', 'c:/proj')).toBe('src/a.rs');
  });

  it('returns the path unchanged when outside the workspace', () => {
    expect(relativeToWorkspace('D:/other/x.txt', 'C:/proj')).toBe('D:/other/x.txt');
  });
});
