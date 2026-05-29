import { describe, it, expect } from 'vitest';
import { expandBackrefs } from '../lib/replace-preview';

const noFlags = { regex: false, case_sensitive: true, whole_word: false } as const;
const regex = { regex: true, case_sensitive: true, whole_word: false } as const;

describe('expandBackrefs', () => {
  it('substitutes capture-group backreferences in regex mode', () => {
    expect(
      expandBackrefs('alice@example.com', '(\\w+)@example\\.com', '$1@new.com', regex)
    ).toBe('alice@new.com');
  });

  it('supports $& for the whole match in regex mode', () => {
    expect(
      expandBackrefs('foo', 'fo+', '<<$&>>', regex)
    ).toBe('<<foo>>');
  });

  it('preserves dollar-prefixed literals in literal mode', () => {
    expect(
      expandBackrefs('foo', 'foo', '$5 dollars', noFlags)
    ).toBe('$5 dollars');
  });

  it('falls back to literal replacement when the pattern is invalid for JS', () => {
    const ruleish = { regex: true, case_sensitive: true, whole_word: false } as const;
    expect(
      expandBackrefs('alpha', '(?P<word>\\w+)', '$word', ruleish)
    ).toBe('$word');
  });
});
