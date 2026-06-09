import { EditorSelection, type EditorState, type SelectionRange } from '@codemirror/state';

/**
 * Build a selection that adds one cursor per existing range on the line `dir`
 * (-1 = above, +1 = below) at the same column, clamped to the target line's
 * length. Ranges whose target line is outside the document contribute nothing,
 * and a target position that already holds a cursor is skipped (no duplicate).
 * If nothing can be added, the original `state.selection` is returned (same
 * reference) so callers can treat that as a no-op.
 */
export function addCursorVertical(state: EditorState, dir: -1 | 1): EditorSelection {
  const { doc } = state;
  const existing = state.selection.ranges;
  const seen = new Set<number>();
  for (const r of existing) if (r.empty) seen.add(r.head);
  const added: SelectionRange[] = [];

  for (const r of existing) {
    const line = doc.lineAt(r.head);
    const col = r.head - line.from;
    const targetNum = line.number + dir;
    if (targetNum < 1 || targetNum > doc.lines) continue;
    const target = doc.line(targetNum);
    const pos = target.from + Math.min(col, target.length);
    if (seen.has(pos)) continue;
    seen.add(pos);
    added.push(EditorSelection.cursor(pos));
  }

  if (added.length === 0) return state.selection;
  const ranges = [...existing, ...added];
  // Keep the newest cursor primary so repeated presses keep extending in `dir`.
  return EditorSelection.create(ranges, ranges.length - 1);
}
