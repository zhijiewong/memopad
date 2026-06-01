import { describe, it, expect } from 'vitest';
import { parseGotoLine } from '../lib/cursor';
import { useCursorPos } from '../stores/cursorPos';

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

describe('useCursorPos', () => {
  it('defaults to 1,1', () => {
    useCursorPos.getState().reset();
    expect(useCursorPos.getState().line).toBe(1);
    expect(useCursorPos.getState().col).toBe(1);
  });
  it('set updates line and col', () => {
    useCursorPos.getState().set(7, 3);
    expect(useCursorPos.getState().line).toBe(7);
    expect(useCursorPos.getState().col).toBe(3);
  });
  it('reset returns to 1,1', () => {
    useCursorPos.getState().set(9, 9);
    useCursorPos.getState().reset();
    expect(useCursorPos.getState().line).toBe(1);
    expect(useCursorPos.getState().col).toBe(1);
  });
});
