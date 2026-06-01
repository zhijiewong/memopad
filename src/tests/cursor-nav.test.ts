import { describe, it, expect } from 'vitest';
import { parseGotoLine } from '../lib/cursor';

describe('parseGotoLine', () => {
  it('returns an in-range line as-is', () => {
    expect(parseGotoLine('5', 10)).toBe(5);
  });
  it('clamps above total to the last line', () => {
    expect(parseGotoLine('99', 10)).toBe(10);
  });
  it('clamps below 1 to 1', () => {
    expect(parseGotoLine('0', 10)).toBe(1);
    expect(parseGotoLine('-3', 10)).toBe(1);
  });
  it('rejects non-numeric and empty input', () => {
    expect(parseGotoLine('abc', 10)).toBeNull();
    expect(parseGotoLine('', 10)).toBeNull();
    expect(parseGotoLine('  ', 10)).toBeNull();
    expect(parseGotoLine('3.5', 10)).toBeNull();
  });
  it('guards totalLines of 0', () => {
    expect(parseGotoLine('5', 0)).toBe(1);
  });
});
