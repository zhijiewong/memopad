import { describe, it, expect } from 'vitest';
import { fuzzyMatch, rankPaths } from '../lib/quick-open';

describe('fuzzyMatch', () => {
  it('returns null when query chars do not appear in order', () => {
    expect(fuzzyMatch('xyz', 'C:/proj/abc.rs')).toBeNull();
  });

  it('scores contiguous runs higher than scattered matches', () => {
    const contiguous = fuzzyMatch('app', 'src/App.tsx');
    const scattered = fuzzyMatch('app', 'src/a/p/p.tsx');
    expect(contiguous).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(contiguous!.score).toBeGreaterThan(scattered!.score);
  });

  it('boosts basename match over path-only match', () => {
    const basename = fuzzyMatch('app', 'src/proj/App.tsx');
    const pathOnly = fuzzyMatch('app', 'src/AppDir/x.tsx');
    expect(basename).not.toBeNull();
    expect(pathOnly).not.toBeNull();
    expect(basename!.score).toBeGreaterThan(pathOnly!.score);
  });
});

describe('rankPaths', () => {
  it('recent files outrank equally-scored non-recent', () => {
    const paths = ['C:/proj/App.tsx', 'C:/old/App.tsx'];
    const matches = rankPaths(paths, 'app', ['C:/old/App.tsx']);
    expect(matches.length).toBe(2);
    expect(matches[0].path).toBe('C:/old/App.tsx');
  });
});
