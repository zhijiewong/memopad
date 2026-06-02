import { describe, it, expect } from 'vitest';
import { isInvalidMove } from '../lib/path';

describe('isInvalidMove', () => {
  it('rejects moving into itself', () => {
    expect(isInvalidMove('C:/proj/d', 'C:/proj/d')).toBe(true);
  });
  it('rejects moving into a descendant', () => {
    expect(isInvalidMove('C:/proj/d', 'C:/proj/d/child')).toBe(true);
  });
  it('rejects moving into the current parent (no-op)', () => {
    expect(isInvalidMove('C:/proj/a.txt', 'C:/proj')).toBe(true);
  });
  it('allows moving into a sibling folder', () => {
    expect(isInvalidMove('C:/proj/a.txt', 'C:/proj/sub')).toBe(false);
  });
  it('is separator- and case-insensitive', () => {
    expect(isInvalidMove('C:\\proj\\a.txt', 'c:/PROJ')).toBe(true);
  });
});
