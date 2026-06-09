import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { addCursorVertical } from '../lib/multicursor';

function stateWith(doc: string, sel: EditorSelection): EditorState {
  return EditorState.create({
    doc,
    selection: sel,
    extensions: EditorState.allowMultipleSelections.of(true),
  });
}

describe('addCursorVertical', () => {
  it('adds a cursor on the line below at the same column', () => {
    // "abc\ndef": cursor at col 2 on line 1 (pos 2)
    const s = stateWith('abc\ndef', EditorSelection.create([EditorSelection.cursor(2)]));
    const sel = addCursorVertical(s, 1);
    expect(sel.ranges.map((r) => r.head)).toEqual([2, 6]); // line2 from=4, +2
    expect(sel.main.head).toBe(6); // newest cursor is primary
  });

  it('adds a cursor on the line above at the same column', () => {
    const s = stateWith('abc\ndef', EditorSelection.create([EditorSelection.cursor(6)])); // line2 col2
    const sel = addCursorVertical(s, -1);
    expect(sel.ranges.map((r) => r.head)).toEqual([2, 6]);
    expect(sel.main.head).toBe(2);
  });

  it('clamps the column to a shorter target line', () => {
    // "abcde\nxy": cursor at col 4 (pos 4) on line1; line2 length 2
    const s = stateWith('abcde\nxy', EditorSelection.create([EditorSelection.cursor(4)]));
    const sel = addCursorVertical(s, 1);
    // line2 from=6, min(4,2)=2 => 8
    expect(sel.ranges.map((r) => r.head)).toEqual([4, 8]);
  });

  it('stacks one new cursor per existing range', () => {
    // two cursors at col1 on lines 1 and 2 of a 3-line doc
    const s = stateWith('aaa\nbbb\nccc', EditorSelection.create([
      EditorSelection.cursor(1), // line1 col1
      EditorSelection.cursor(5), // line2 col1
    ]));
    const sel = addCursorVertical(s, 1);
    // adds line2 col1 (pos5 — already present, deduped) and line3 col1 (pos9)
    expect(sel.ranges.map((r) => r.head).sort((a, b) => a - b)).toEqual([1, 5, 9]);
  });

  it('returns the same selection unchanged at the document boundary', () => {
    const s = stateWith('abc\ndef', EditorSelection.create([EditorSelection.cursor(1)])); // line1
    const sel = addCursorVertical(s, -1); // nothing above line 1
    expect(sel).toBe(s.selection);
  });
});
