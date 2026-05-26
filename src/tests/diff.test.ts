import { describe, it, expect } from 'vitest';
import { lineDiff } from '../lib/diff';

describe('lineDiff', () => {
  it('returns context lines for identical input', () => {
    const result = lineDiff('a\nb\nc\n', 'a\nb\nc\n');
    expect(result.every((row) => row.type === 'context')).to.equal(true);
  });

  it('flags added lines', () => {
    const result = lineDiff('a\nc\n', 'a\nb\nc\n');
    const adds = result.filter((r) => r.type === 'add').map((r) => r.value);
    expect(adds.join('').trim()).to.equal('b');
  });

  it('flags removed lines', () => {
    const result = lineDiff('a\nb\nc\n', 'a\nc\n');
    const dels = result.filter((r) => r.type === 'del').map((r) => r.value);
    expect(dels.join('').trim()).to.equal('b');
  });

  it('returns empty rows for two empty strings', () => {
    const result = lineDiff('', '');
    expect(result).to.deep.equal([]);
  });

  it('handles mismatched trailing newlines', () => {
    const result = lineDiff('hello\n', 'hello');
    expect(result.every((r) => r.type === 'context' || r.type === 'del' || r.type === 'add')).to.equal(true);
    expect(result.some((r) => r.value.includes('hello'))).to.equal(true);
  });
});
