# Memopad v2 — Quick Open by Filename (Ctrl+P)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Press `Ctrl+P` to fuzzy-find any file in the workspace folder; Enter to open it in the focused pane. Reuses the existing `ignore` crate walk and the existing `fs::open_file` + `buffers.openBuffer` pipeline.

**Architecture:** A new Tauri command `walk_files(workspace) -> WalkResponse` collects file paths (cap 10,000). A new pure helper `src/lib/quick-open.ts` (`fuzzyMatch`, `rankPaths`) scores matches client-side with recent-file boost. A new `QuickOpenPalette` component renders the modal + input + result list. `Ctrl+P` triggers it; opens hit `setFocusedBuffer` so split mode lands the file in the right pane.

**Tech Stack:** Tauri 2, Rust (`ignore` crate already in deps), React + Zustand. No new dependencies.

**Spec section reference:** `docs/superpowers/specs/2026-05-29-quick-open-design.md` (all sections).

---

## File Structure

```
memopad/
├── src-tauri/
│   ├── src/
│   │   ├── files.rs                  MODIFY — walk_files + WalkResponse + 3 tests
│   │   └── lib.rs                    MODIFY — register walk_files command
├── src/
│   ├── lib/
│   │   ├── tauri.ts                  MODIFY — WalkResponse type + walkFiles wrapper
│   │   └── quick-open.ts             CREATE — fuzzyMatch + rankPaths (pure)
│   ├── components/
│   │   └── QuickOpenPalette.tsx      CREATE — modal + input + result list
│   ├── commands/
│   │   └── builtins.ts               MODIFY — quickOpen.show command
│   ├── App.tsx                       MODIFY — quickOpenShown state, __memopadShowQuickOpen hook, Ctrl+P keybinding, mount the palette
│   └── tests/
│       └── quick-open.test.ts        CREATE — 4 vitest cases
└── tests/e2e/
    └── quick-open.spec.ts            CREATE — 1 e2e test
```

Boundary intent:
- **`files.rs`** owns the recursive walk + cap enforcement. Pure function; tests use a tempdir.
- **`quick-open.ts`** is pure (no React, no store). Both functions are framework-free, easy to test.
- **`QuickOpenPalette.tsx`** is the only React consumer. Owns the modal lifecycle + walk IPC + ranking + keyboard nav + open-on-Enter.
- **`App.tsx`** owns the global keybinding + window hook; everything else flows through that.

---

## Task 1: Rust `walk_files` + 3 tests

**Files:**
- Modify: `src-tauri/src/files.rs`

- [ ] **Step 1: Append the constant, struct, and function stub at the bottom of `src-tauri/src/files.rs`** (before the existing `#[cfg(test)] mod tests`)

```rust
pub const MAX_QUICK_OPEN_FILES: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WalkResponse {
    pub files: Vec<String>,
    pub truncated: bool,
    pub elapsed_ms: u64,
}

pub fn walk_files(_workspace: &Path) -> Result<WalkResponse, FilesError> {
    // Filled in by step 3.
    Ok(WalkResponse { files: Vec::new(), truncated: false, elapsed_ms: 0 })
}
```

- [ ] **Step 2: Append three failing tests inside the existing `mod tests` block**

Reuse the existing `tmp` and `touch` test helpers (defined in `files.rs` from slice 2). Append:

```rust
#[test]
fn walk_files_returns_all_files_under_workspace() {
    let dir = tmp("walk_all");
    touch(&dir, "a.txt");
    touch(&dir, "sub/b.rs");
    touch(&dir, "sub/c.json");

    let resp = walk_files(&dir).unwrap();
    let names: Vec<String> = resp.files.iter()
        .map(|p| p.replace('\\', "/"))
        .collect();
    let names_concat = names.join("|");
    assert!(names_concat.contains("a.txt"), "got {:?}", names);
    assert!(names_concat.contains("sub/b.rs"), "got {:?}", names);
    assert!(names_concat.contains("sub/c.json"), "got {:?}", names);
    assert_eq!(resp.files.len(), 3, "expected exactly 3 files, got {:?}", names);
    assert!(!resp.truncated);
}

#[test]
fn walk_files_respects_gitignore() {
    let dir = tmp("walk_ignore");
    std::fs::write(dir.join(".gitignore"), "target/\n").unwrap();
    touch(&dir, "src/main.rs");
    touch(&dir, "target/build.log");

    let resp = walk_files(&dir).unwrap();
    let names_concat: String = resp.files.iter()
        .map(|p| p.replace('\\', "/"))
        .collect::<Vec<_>>()
        .join("|");
    assert!(names_concat.contains("src/main.rs"), "got {:?}", resp.files);
    assert!(!names_concat.contains("target/build.log"), "target/ should be filtered, got {:?}", resp.files);
}

#[test]
fn walk_files_caps_at_max_quick_open_files() {
    let dir = tmp("walk_cap");
    // 10_050 files
    for i in 0..10_050 {
        std::fs::write(dir.join(format!("f{}.txt", i)), b"").unwrap();
    }
    let resp = walk_files(&dir).unwrap();
    assert!(resp.files.len() <= MAX_QUICK_OPEN_FILES, "got {} files, cap is {}", resp.files.len(), MAX_QUICK_OPEN_FILES);
    assert!(resp.truncated, "expected truncated flag when above cap");
}
```

- [ ] **Step 3: Run to confirm fail**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib files::tests::walk_files_returns_all_files_under_workspace
cd ..
```

Expected: FAIL — stub returns empty files vec.

- [ ] **Step 4: Replace the stub with the real implementation**

Replace the body of `walk_files` in `src-tauri/src/files.rs`:

```rust
pub fn walk_files(workspace: &Path) -> Result<WalkResponse, FilesError> {
    use ignore::WalkBuilder;

    if !workspace.exists() {
        return Err(FilesError::PathMissing);
    }
    if !workspace.is_dir() {
        return Err(FilesError::NotADirectory);
    }

    let started = std::time::Instant::now();

    let mut files: Vec<String> = Vec::new();
    let mut walker = WalkBuilder::new(workspace);
    walker.standard_filters(true);
    walker.require_git(false);
    let walker = walker.build();

    let mut truncated = false;
    for entry in walker {
        if files.len() >= MAX_QUICK_OPEN_FILES {
            truncated = true;
            break;
        }
        let entry = match entry { Ok(e) => e, Err(_) => continue };
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            files.push(entry.path().to_string_lossy().to_string());
        }
    }

    files.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));

    Ok(WalkResponse {
        files,
        truncated,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}
```

- [ ] **Step 5: Run the three tests**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib files::tests::walk_files_returns_all_files_under_workspace
cargo test --lib files::tests::walk_files_respects_gitignore
cargo test --lib files::tests::walk_files_caps_at_max_quick_open_files
cd ..
```

Expected: all 3 PASS. The cap test creates 10,050 files in a tempdir; it may take a second or two on slower disks.

- [ ] **Step 6: Commit**

```powershell
git add src-tauri/src/files.rs
git commit -m "files: walk_files (recursive ignore-aware file list) + 3 tests"
```

---

## Task 2: Wire `walk_files` as a Tauri command

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command wrapper**

In `src-tauri/src/lib.rs`, after the existing `list_dir` command, add:

```rust
#[tauri::command]
fn walk_files(workspace_folder: String) -> Result<files::WalkResponse, String> {
    files::walk_files(std::path::Path::new(&workspace_folder)).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register in the `invoke_handler!` macro**

Add `walk_files,` after `list_dir,`:

```rust
            list_dir,
            walk_files,
```

- [ ] **Step 3: Verify**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo check
cd ..
```

Expected: clean compile.

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/lib.rs
git commit -m "files: register walk_files Tauri command"
```

---

## Task 3: TS IPC wrapper

**Files:**
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Append at the bottom of `src/lib/tauri.ts`**

```ts
export interface WalkResponse {
  files: string[];
  truncated: boolean;
  elapsed_ms: number;
}

export async function walkFiles(workspaceFolder: string): Promise<WalkResponse> {
  return invoke<WalkResponse>('walk_files', { workspaceFolder });
}
```

- [ ] **Step 2: Type-check**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/tauri.ts
git commit -m "tauri: typed walkFiles IPC wrapper"
```

---

## Task 4: `fuzzyMatch` + `rankPaths` pure helpers + 4 tests

**Files:**
- Create: `src/lib/quick-open.ts`
- Create: `src/tests/quick-open.test.ts`

- [ ] **Step 1: Create the failing tests at `src/tests/quick-open.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { fuzzyMatch, rankPaths } from '../lib/quick-open';

describe('fuzzyMatch', () => {
  it('returns null when query chars do not appear in order', () => {
    expect(fuzzyMatch('xyz', 'C:/proj/abc.rs')).toBeNull();
  });

  it('scores contiguous runs higher than scattered matches', () => {
    const contiguous = fuzzyMatch('app', 'src/App.tsx');
    const scattered = fuzzyMatch('app', 'src/a/p/p.tsx');
    expect(contiguous).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(contiguous!.score).toBeGreaterThan(scattered!.score);
  });

  it('boosts basename match over path-only match', () => {
    const basename = fuzzyMatch('app', 'src/proj/App.tsx');
    const pathOnly = fuzzyMatch('app', 'src/AppDir/x.tsx');
    expect(basename).not.toBeNull();
    expect(pathOnly).not.toBeNull();
    expect(basename!.score).toBeGreaterThan(pathOnly!.score);
  });
});

describe('rankPaths', () => {
  it('recent files outrank equally-scored non-recent', () => {
    const paths = ['C:/proj/App.tsx', 'C:/old/App.tsx'];
    const matches = rankPaths(paths, 'app', ['C:/old/App.tsx']);
    expect(matches.length).toBe(2);
    expect(matches[0].path).toBe('C:/old/App.tsx');
  });
});
```

- [ ] **Step 2: Run — should FAIL**

```powershell
npm test -- quick-open
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create `src/lib/quick-open.ts`**

EXACT contents:

```ts
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

  // Score contiguous runs.
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

  // Basename slice.
  let basenameStart = 0;
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i] === '/' || path[i] === '\\') { basenameStart = i + 1; break; }
  }
  const allInBasename = matchedIndices.every((idx) => idx >= basenameStart);
  if (allInBasename) score += 20;

  // Start-at-boundary bonus.
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
```

- [ ] **Step 4: Run the tests**

```powershell
npm test -- quick-open
```

Expected: 4 PASS.

- [ ] **Step 5: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/quick-open.ts src/tests/quick-open.test.ts
git commit -m "quick-open: fuzzyMatch + rankPaths pure helpers + 4 tests"
```

---

## Task 5: `QuickOpenPalette` component

**Files:**
- Create: `src/components/QuickOpenPalette.tsx`

- [ ] **Step 1: Create the component**

EXACT contents:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import { useBuffers } from '../stores/buffers';
import { walkFiles, openFile } from '../lib/tauri';
import { rankPaths, type FuzzyMatch } from '../lib/quick-open';

interface Props {
  onClose: () => void;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(0, i) : '';
}

function relativeTo(workspace: string, p: string): string {
  if (!workspace) return p;
  const sep = workspace.includes('/') ? '/' : '\\';
  const base = workspace.endsWith(sep) ? workspace : workspace + sep;
  return p.toLowerCase().startsWith(base.toLowerCase()) ? p.slice(base.length) : p;
}

export function QuickOpenPalette({ onClose }: Props) {
  const workspaceFolder = useWorkspace((s) => s.workspaceFolder);
  const openFolder = useWorkspace((s) => s.openFolder);

  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<string[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Walk on mount.
  useEffect(() => {
    if (!workspaceFolder) return;
    walkFiles(workspaceFolder)
      .then((resp) => {
        setFiles(resp.files);
        setTruncated(resp.truncated);
      })
      .catch((err) => setError((err as Error).message));
  }, [workspaceFolder]);

  // Focus the input on mount.
  useEffect(() => { inputRef.current?.focus(); }, []);

  const recentPaths = useMemo(() => {
    const open = useBuffers.getState().buffers.map((b) => b.path).filter((p): p is string => !!p);
    const closed = useBuffers.getState().recentlyClosed.map((b) => b.path).filter((p): p is string => !!p);
    return Array.from(new Set([...open, ...closed]));
  }, []);

  const matches: FuzzyMatch[] = useMemo(() => {
    if (!files) return [];
    return rankPaths(files, query, recentPaths);
  }, [files, query, recentPaths]);

  // Reset selection when matches change.
  useEffect(() => { setSelected(0); }, [matches]);

  async function openPicked(path: string) {
    try {
      const existing = useBuffers.getState().buffers.find((b) => b.path === path);
      if (existing) {
        useBuffers.getState().setFocusedBuffer(existing.id);
      } else {
        const opened = await openFile(path);
        const newId = useBuffers.getState().openBuffer(opened);
        useBuffers.getState().setFocusedBuffer(newId);
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(matches.length - 1, s + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const m = matches[selected];
      if (m) openPicked(m.path);
      return;
    }
  }

  return (
    <div
      data-testid="quick-open-overlay"
      className="fixed inset-0 z-40 bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={onKeyDown}
    >
      <div
        data-testid="quick-open-palette"
        className="mx-auto mt-24 w-[640px] max-w-[90vw] rounded border border-neutral-700 bg-neutral-900 shadow-xl"
      >
        {!workspaceFolder ? (
          <div className="p-4 text-sm text-neutral-300">
            <p className="mb-3">Open a folder first.</p>
            <button
              type="button"
              onClick={() => { openFolder().catch(() => {}); onClose(); }}
              className="rounded bg-neutral-700 px-3 py-1 text-neutral-100 hover:bg-neutral-600"
            >
              Open folder…
            </button>
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              data-testid="quick-open-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Go to file…"
              className="w-full rounded-t bg-transparent px-4 py-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
            />
            {error && <div data-testid="quick-open-error" className="border-t border-neutral-700 px-4 py-2 text-xs text-red-400">{error}</div>}
            {files === null && !error && (
              <div className="border-t border-neutral-700 p-4 text-xs text-neutral-500">Loading…</div>
            )}
            {files !== null && matches.length === 0 && (
              <div className="border-t border-neutral-700 p-4 text-xs text-neutral-500">No matches.</div>
            )}
            {matches.length > 0 && (
              <ul role="listbox" className="max-h-[60vh] overflow-auto border-t border-neutral-700">
                {matches.map((m, i) => (
                  <li key={m.path}>
                    <button
                      type="button"
                      role="option"
                      data-testid="quick-open-row"
                      data-selected={i === selected}
                      onMouseEnter={() => setSelected(i)}
                      onClick={() => openPicked(m.path)}
                      className={`block w-full truncate px-4 py-1.5 text-left text-xs ${
                        i === selected ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-300 hover:bg-neutral-800'
                      }`}
                      title={m.path}
                    >
                      <span className="font-semibold">{basename(m.path)}</span>
                      <span className="ml-2 text-neutral-500">{relativeTo(workspaceFolder, dirname(m.path))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {truncated && (
              <div className="border-t border-neutral-700 px-4 py-1 text-xs text-amber-400">
                Showing first 10,000 files — refine your query.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```powershell
git add src/components/QuickOpenPalette.tsx
git commit -m "ui: QuickOpenPalette modal with fuzzy match + arrow nav + open-on-Enter"
```

---

## Task 6: `quickOpen.show` command + `Ctrl+P` keybinding + mount

**Files:**
- Modify: `src/commands/builtins.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Register the command in `builtins.ts`**

Append to the end of `registerBuiltins()`:

```ts
  register({
    id: 'quickOpen.show',
    title: 'Go to File…',
    shortcut: 'Ctrl+P',
    run: () => {
      (window as unknown as { __memopadShowQuickOpen?: () => void })
        .__memopadShowQuickOpen?.();
    },
  });
```

- [ ] **Step 2: Add state + import in `App.tsx`**

Near the existing top-of-file imports, add:

```ts
import { QuickOpenPalette } from './components/QuickOpenPalette';
```

Near the existing `const [paletteOpen, setPaletteOpen] = useState(false);` line, add:

```ts
const [quickOpenShown, setQuickOpenShown] = useState(false);
```

- [ ] **Step 3: Register the window hook**

Inside the existing useEffect that registers window helpers (the one with `__memopadToggleSidebar`), add:

```ts
(window as unknown as { __memopadShowQuickOpen?: () => void }).__memopadShowQuickOpen = () => setQuickOpenShown(true);
```

- [ ] **Step 4: Add the Ctrl+P keybinding**

In `App.tsx`, find the existing keydown ladder. There is currently a branch for `Ctrl+Shift+P` (`if (key === 'p' && e.shiftKey)`). Immediately BEFORE that branch, add a new `Ctrl+P` (plain) branch:

```ts
if (key === 'p' && !e.shiftKey) {
  e.preventDefault();
  runCommand('quickOpen.show');
  return;
}
```

Order matters: this MUST come before the `e.shiftKey` branch so the plain Ctrl+P case is handled first.

- [ ] **Step 5: Mount the palette**

In the JSX near the existing `{paletteOpen && <CommandPalette … />}` mount, add:

```tsx
{quickOpenShown && (
  <QuickOpenPalette onClose={() => setQuickOpenShown(false)} />
)}
```

- [ ] **Step 6: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean (real output, ignore LSP false positives); all vitest tests pass.

- [ ] **Step 7: Commit**

```powershell
git add src/commands/builtins.ts src/App.tsx
git commit -m "app: quickOpen.show command + Ctrl+P binding + palette mount"
```

---

## Task 7: e2e test

**Files:**
- Create: `tests/e2e/quick-open.spec.ts`

- [ ] **Step 1: Create the spec**

`tests/e2e/quick-open.spec.ts`:

```ts
import { expect } from 'chai';
import * as path from 'node:path';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const FIXTURE = path.resolve(__dirname, 'fixtures', 'workspace');

describe('quick open', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadTestSetWorkspace?: (folder: string | null) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestSetWorkspace?.(null as unknown as string);
    });
    await sleep(150);
  });

  it('Ctrl+P opens the palette; typing + Enter opens the picked file', async () => {
    // Set workspace.
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );
    await sleep(150);

    // Press Ctrl+P.
    await getBrowser().keys(['Control', 'p']);
    await sleep(300);

    const paletteVisible = await classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="quick-open-palette"]');`,
    );
    expect(paletteVisible).to.equal(true);

    // Wait for walk to complete.
    await sleep(500);

    // Type "notes" via synthetic input event.
    await classicExecute<void>(
      `const i = document.querySelector('[data-testid="quick-open-input"]');
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(i, 'notes');
       i.dispatchEvent(new Event('input', { bubbles: true }));
       return undefined;`,
    );
    await sleep(300);

    // Confirm at least one row is rendered.
    const rowCount = await classicExecute<number>(
      `return document.querySelectorAll('[data-testid="quick-open-row"]').length;`,
    );
    expect(rowCount).to.be.greaterThanOrEqual(1);

    // Press Enter to open the first row.
    await getBrowser().keys(['Enter']);
    await sleep(400);

    // Assert the palette closed.
    const stillOpen = await classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="quick-open-palette"]');`,
    );
    expect(stillOpen).to.equal(false);

    // Assert the active buffer path ends with notes.txt.
    const activePath = await classicExecute<string | null>(
      `if (window.__memopadTestGetActiveBufferPath) return window.__memopadTestGetActiveBufferPath();
       return null;`,
    );
    if (activePath) {
      expect(activePath).to.match(/notes\.txt$/);
    } else {
      // Fallback: check that some buffer with notes.txt is now open.
      const hasNotes = await classicExecute<boolean>(
        `return Array.from(document.querySelectorAll('[data-testid^="tab-"]')).some(t => (t.textContent || '').includes('notes.txt'));`,
      );
      expect(hasNotes).to.equal(true);
    }
  });
});
```

- [ ] **Step 2: Type-check the e2e tsconfig**

```powershell
npx tsc -p tsconfig.e2e.json --noEmit 2>&1
```

Expected: same baseline `TransformReturn<T>` pattern (+1 new instance for this file only).

- [ ] **Step 3: DO NOT run `npm run e2e`** — defer to Task 8.

- [ ] **Step 4: Commit**

```powershell
git add tests/e2e/quick-open.spec.ts
git commit -m "e2e: Ctrl+P opens quick-open + typing + Enter opens the file"
```

---

## Task 8: Gates + results doc

**Files:**
- Create: `docs/superpowers/plans/v2-quick-open-results.md`

- [ ] **Step 1: tsc + vitest + cargo**

```powershell
npx tsc --noEmit
npm test
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib
cd ..
```

Capture:
- vitest total (expected +4 from quick-open tests)
- cargo total (expected +3 from walk_files tests)

- [ ] **Step 2: Release build**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri build
```

Capture MSI + app.exe sizes. No new Rust dependencies — should be within rounding.

- [ ] **Step 3: Skip `npm run e2e`** — defer to manual verification.

- [ ] **Step 4: Write the results doc**

Create `docs/superpowers/plans/v2-quick-open-results.md`:

```markdown
# v2 Quick Open by Filename — Results

## Automated test gates

- Vitest: <N> tests passing (+4 quick-open)
- cargo test: <N> tests passing (+3 walk_files)
- e2e (WebdriverIO): spec written (1 test); full run deferred to manual verification
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: <X.XX> MB
- app.exe size: <X.XX> MB

## What shipped

- `src-tauri/src/files.rs` gained `walk_files` + `WalkResponse` + `MAX_QUICK_OPEN_FILES = 10_000` + 3 tests
- New Tauri command: `walk_files`
- `src/lib/quick-open.ts` — `fuzzyMatch` + `rankPaths` pure helpers (+4 tests)
- `src/components/QuickOpenPalette.tsx` — modal + input + result list + arrow nav + Enter-to-open
- New command + keybinding: `quickOpen.show` (Ctrl+P)
- `src/App.tsx` wires `quickOpenShown` state, `__memopadShowQuickOpen` window hook, Ctrl+P keybinding, palette mount

## What is intentionally NOT in this slice

- Multi-folder workspaces
- Cache between palette opens
- Symbol search / workspace symbol search
- Match content excerpts in the row
- Streaming results
- Persisted MRU across sessions

## Follow-ups

1. Result cache + invalidation when fs-watcher (slice 5) lands
2. Match highlighting inside the result row (use `matchedIndices`)
3. Recent-file boost weight tuning based on user feedback
```

Fill in actual numbers.

- [ ] **Step 5: Commit**

```powershell
git add docs/superpowers/plans/v2-quick-open-results.md
git commit -m "v2 quick open: record results"
```

---

## Self-review notes (don't delete)

**Spec coverage check:**

| Spec section | Covered by |
| --- | --- |
| Rust `walk_files` + `WalkResponse` + cap | Task 1 |
| Rust gitignore + cap + happy-path tests | Task 1 |
| Tauri command registration | Task 2 |
| TS IPC wrapper + type | Task 3 |
| `fuzzyMatch` pure helper with scoring rules | Task 4 |
| `rankPaths` with recent boost | Task 4 |
| 4 vitest tests | Task 4 |
| QuickOpenPalette modal + input + list + arrow nav + Enter | Task 5 |
| Empty state when no workspace | Task 5 |
| Loading state during walk | Task 5 |
| Error display | Task 5 |
| Truncated banner | Task 5 |
| Open into focused pane via setFocusedBuffer | Task 5 (`openPicked`) |
| `quickOpen.show` command | Task 6 |
| Ctrl+P keybinding (before Ctrl+Shift+P branch) | Task 6 |
| `__memopadShowQuickOpen` window hook + mount | Task 6 |
| 1 e2e test | Task 7 |
| Gates + results doc | Task 8 |

**Placeholder scan:** None.

**Type / signature consistency:**
- `WalkResponse { files: Vec<String>, truncated: bool, elapsed_ms: u64 }` (Rust) ↔ `WalkResponse { files: string[]; truncated: boolean; elapsed_ms: number }` (TS) — consistent.
- `walkFiles(workspaceFolder: string)` → `walk_files(workspace_folder)` Tauri arg name mapping is automatic (camelCase ↔ snake_case).
- `fuzzyMatch(query: string, path: string): FuzzyMatch | null` consistent between definition (Task 4) and consumer (Task 5).
- `rankPaths(paths: string[], query: string, recentPaths: string[]): FuzzyMatch[]` consistent.
- `FuzzyMatch { path, score, matchedIndices }` consistent across tests, helper, and consumer.
- `quickOpen.show` command id consistent between registration (Task 6) and the spec's mention.
- `__memopadShowQuickOpen` window hook name consistent between command's `run` (Task 6) and `App.tsx`'s setter registration (Task 6).
- `data-testid="quick-open-palette"`, `quick-open-input`, `quick-open-row`, `quick-open-overlay`, `quick-open-error` consistent between component (Task 5) and e2e spec (Task 7).

**Notes for executor:**
- Slice 8's `setFocusedBuffer` is the public API for "put this buffer in the focused pane." Task 5's `openPicked` uses it. If slice 8 is NOT in this worktree's base (e.g. the worktree branches from `origin/main` without slice 8 merged), the code will fail to compile. This plan ASSUMES slice 8 is available — the executor should either (a) base the worktree on `worktree-v2-split-view`, or (b) substitute `useBuffers.getState().switchTo` for `setFocusedBuffer` (the slice-8 fallback) if slice 8 isn't available.
- The Ctrl+P keybinding placement matters. JavaScript ladders short-circuit on the first matching branch. The new `if (key === 'p' && !e.shiftKey)` must precede the existing `if (key === 'p' && e.shiftKey)` so that Ctrl+P (without Shift) is caught first.
- This plan does NOT push to remote and does NOT merge to main (matches the user's standing "do not commit until I say so" boundary; local commits in the worktree are allowed per the established workflow).
