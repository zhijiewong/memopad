import type { FindOptions } from './tauri';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compute what `replacement` would expand to for a single match of `query`
 * inside `oldSpan`. Mirrors Rust's `regex::Regex::replace` semantics for the
 * common case (literal escape when regex=off, whole_word wrapping, case flag).
 *
 * On any JS RegExp construction error (e.g. Rust-only syntax like `?P<name>`),
 * returns the literal `replacement` string so the preview degrades gracefully.
 * The actual file write in Rust is unaffected by this helper.
 */
export function expandBackrefs(
  oldSpan: string,
  query: string,
  replacement: string,
  opts: FindOptions,
): string {
  try {
    let pattern = opts.regex ? query : escapeRegex(query);
    if (opts.whole_word) pattern = `\\b(?:${pattern})\\b`;
    const flags = opts.case_sensitive ? '' : 'i';
    const re = new RegExp(pattern, flags);
    return oldSpan.replace(re, replacement);
  } catch {
    return replacement;
  }
}
