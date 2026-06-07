import { EditorState } from '@codemirror/state';
import { matchBrackets } from '@codemirror/language';

type Match = ReturnType<typeof matchBrackets>;

/** A bracket was found AND it has a balanced partner of the correct type. */
function usable(m: Match): m is NonNullable<Match> & { end: { from: number; to: number } } {
  return !!m && m.matched && !!m.end;
}

/**
 * Return the caret destination at the bracket matching the one adjacent to `pos`,
 * or null when the caret is not next to a balanced bracket.
 *
 * Looks for a bracket immediately before the caret (dir -1) first, then
 * immediately after it (dir +1) — matching CodeMirror's own bracket-matching
 * precedence so navigation agrees with the highlight. Falls through on
 * "found but no valid match" (not just null) to handle the sandwiched case ")(".
 * The destination is the far side of the partner bracket (the side pointing away
 * from the start bracket) so repeated invocations ping-pong between the pair.
 */
export function matchingBracketTarget(state: EditorState, pos: number): number | null {
  let m = matchBrackets(state, pos, -1);
  if (!usable(m)) m = matchBrackets(state, pos, 1);
  if (!usable(m)) return null;
  const { start, end } = m;
  return end.from > start.from ? end.to : end.from;
}
