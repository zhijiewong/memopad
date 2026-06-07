import { describe, it, expect } from 'vitest';
import { EditorState, type Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { matchingBracketTarget } from '../lib/brackets';

const stateFor = (doc: string, extensions: Extension[] = []) =>
  EditorState.create({ doc, extensions });

describe('matchingBracketTarget', () => {
  it('caret before an opening bracket → lands after the matching close', () => {
    // "(foo)": '(' at 0, ')' at 4. Caret at 0 → after ')' = 5.
    expect(matchingBracketTarget(stateFor('(foo)'), 0)).to.equal(5);
  });

  it('caret after a closing bracket → lands before the matching open', () => {
    // Caret at 5 (after ')') → before '(' = 0.
    expect(matchingBracketTarget(stateFor('(foo)'), 5)).to.equal(0);
  });

  it('resolves the correct partner when brackets nest', () => {
    // "(a(b)c)": outer '(' 0 / ')' 6, inner '(' 2 / ')' 4.
    // Caret at 0 (only the outer '(' is adjacent) → after outer ')' = 7.
    expect(matchingBracketTarget(stateFor('(a(b)c)'), 0)).to.equal(7);
    // Caret at 2 (only the inner '(' is adjacent) → after inner ')' = 5.
    expect(matchingBracketTarget(stateFor('(a(b)c)'), 2)).to.equal(5);
  });

  it('returns null when the caret is not adjacent to a bracket', () => {
    // "(foo)": caret at 2 is between 'f' and 'o'.
    expect(matchingBracketTarget(stateFor('(foo)'), 2)).to.equal(null);
  });

  it('returns null for a mismatched or unbalanced bracket', () => {
    expect(matchingBracketTarget(stateFor('(]'), 0)).to.equal(null);
    expect(matchingBracketTarget(stateFor('(foo'), 0)).to.equal(null);
  });

  it('matches inside a real language grammar (tree-aware path)', () => {
    // "function f(){}": '(' at 10, ')' at 11. Caret at 10 → after ')' = 12.
    const s = stateFor('function f(){}', [javascript()]);
    expect(matchingBracketTarget(s, 10)).to.equal(12);
  });

  it('ping-pongs: applying the target twice returns to the start', () => {
    const s = stateFor('(foo)');
    const a = matchingBracketTarget(s, 0);
    expect(a).to.equal(5);
    expect(matchingBracketTarget(s, a as number)).to.equal(0);
  });
});
