export interface FuzzyMatch {
  path: string;
  score: number;
  matchedIndices: number[];
}

/**
 * Subsequence fuzzy match. Returns null if the lowercase chars of `query`
 * do not appear in `path` in order.
 *
 * Scoring:
 *   +N*N  per contiguous run of length N (rewards typing prefixes)
 *   +20   bonus if every matched index lies within the basename slice
 *   +10   bonus if the match starts at index 0 or after a path separator
 *
 * Recent-file boost is applied separately by `rankPaths`.
 */
export function fuzzyMatch(query: string, path: string): FuzzyMatch | null {
  if (query.length === 0) {
    return { path, score: 0, matchedIndices: [] };
  }
  const q = query.toLowerCase();
  const p = path.toLowerCase();
  const matchedIndices: number[] = [];
  let qi = 0;
  for (let i = 0; i < p.length && qi < q.length; i++) {
    if (p.charCodeAt(i) === q.charCodeAt(qi)) {
      matchedIndices.push(i);
      qi++;
    }
  }
  if (qi < q.length) return null;

  let score = 0;
  let runLen = 1;
  for (let i = 1; i < matchedIndices.length; i++) {
    if (matchedIndices[i] === matchedIndices[i - 1] + 1) {
      runLen++;
    } else {
      score += runLen * runLen;
      runLen = 1;
    }
  }
  score += runLen * runLen;

  let basenameStart = 0;
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i] === '/' || path[i] === '\\') { basenameStart = i + 1; break; }
  }
  const allInBasename = matchedIndices.every((idx) => idx >= basenameStart);
  if (allInBasename) score += 20;

  const first = matchedIndices[0];
  if (first === 0 || path[first - 1] === '/' || path[first - 1] === '\\') {
    score += 10;
  }

  return { path, score, matchedIndices };
}

/**
 * Score `paths` against `query`, applying a `+10` recent-file boost when
 * a path is found in `recentPaths`. Returns up to 50 matches sorted by
 * descending score (stable by path for ties).
 */
export function rankPaths(paths: string[], query: string, recentPaths: string[]): FuzzyMatch[] {
  const recentSet = new Set(recentPaths);
  const matches: FuzzyMatch[] = [];
  for (const p of paths) {
    const m = fuzzyMatch(query, p);
    if (m === null) continue;
    const boosted: FuzzyMatch = recentSet.has(p)
      ? { ...m, score: m.score + 10 }
      : m;
    matches.push(boosted);
  }
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  return matches.slice(0, 50);
}
