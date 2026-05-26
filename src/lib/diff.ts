import { diffLines } from 'diff';

export type DiffRowType = 'add' | 'del' | 'context';

export interface DiffRow {
  type: DiffRowType;
  value: string;
}

/**
 * Compare two strings line by line. Returns an ordered list of rows that
 * together reconstruct both sides — each row is either an additive line
 * (only in `right`), a removed line (only in `left`), or a shared context
 * line.
 */
export function lineDiff(left: string, right: string): DiffRow[] {
  if (left === '' && right === '') return [];
  const parts = diffLines(left, right);
  const rows: DiffRow[] = [];
  for (const part of parts) {
    const type: DiffRowType = part.added ? 'add' : part.removed ? 'del' : 'context';
    const lines = part.value.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) {
      rows.push({ type, value: line });
    }
  }
  return rows;
}
