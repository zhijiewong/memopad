/** Parse a Go-to-Line input; return the clamped 1-based line, or null if not an integer. */
export function parseGotoLine(input: string, totalLines: number): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return null;
  return Math.max(1, Math.min(n, Math.max(1, totalLines)));
}
