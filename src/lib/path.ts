/**
 * Compute the workspace-relative version of `path`.
 *
 * - Detects the separator from `workspace` (forward if it contains `/`, backslash otherwise).
 * - Trailing separator on `workspace` is normalized.
 * - Prefix match is case-insensitive (Windows convention).
 * - If `path` does not start with the workspace prefix, returns `path` unchanged.
 */
export function relativeToWorkspace(path: string, workspace: string): string {
  if (workspace === '') return path;
  const usesFwd = workspace.includes('/');
  const sep = usesFwd ? '/' : '\\';
  let base = workspace;
  if (!base.endsWith(sep)) base += sep;
  if (path.toLowerCase().startsWith(base.toLowerCase())) {
    return path.slice(base.length);
  }
  return path;
}
