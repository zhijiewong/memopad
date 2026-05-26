# Memopad Phase 5 — Find/Replace, Themes, Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the v1 user-facing feature list. Add an inline find/replace strip with regex support, ship "Memopad Dark" and "Memopad Light" themes that follow system preference, bundle JetBrains Mono so the editor looks the same on every machine, debounce `session.json` writes so we stop hammering disk on every keystroke, and finalize the bundle identifier before any user installs a signed build.

**Architecture:** The find/replace strip is a custom React component that drives CodeMirror 6's `@codemirror/search` extension via `EditorView` dispatches — no built-in CM panel, fully styled like the rest of the chromeless UI. Themes are a thin layer: a Zustand store holds the active theme, the Editor passes the appropriate CodeMirror theme extension, and an outer CSS class on `<html>` toggles app-chrome colors driven by CSS variables. JetBrains Mono ships as `.woff2` files imported by `index.css` so there is no system-font fallback gap. `session.json` writes get the same 500 ms debounce treatment we already use for journal snapshots. The bundle identifier moves from `dev.memopad.app` (which ends in `.app` and collides with macOS app-bundle extensions) to `dev.memopad.editor`.

**Tech Stack:** Tauri 2, React + TypeScript, Zustand, CodeMirror 6, `@codemirror/search` (already a transitive dep), JetBrains Mono (Apache 2.0, vendored).

**Spec section reference:** `docs/superpowers/specs/2026-05-25-memopad-design.md` §4.3 (find/replace inline strip), §4.4 (themes + JetBrains Mono + warm-neutral palette), §5.1 acceptance scenario #5 (regex find/replace correctness).

---

## File Structure

```
memopad/
├── src-tauri/
│   └── tauri.conf.json          MODIFY — identifier rename
├── src/
│   ├── assets/
│   │   └── fonts/
│   │       ├── JetBrainsMono-Regular.woff2     CREATE (vendored)
│   │       └── JetBrainsMono-Bold.woff2        CREATE (vendored)
│   ├── styles/
│   │   └── themes.css           CREATE — CSS variables for dark/light
│   ├── editor/
│   │   ├── memopad-dark.ts      CREATE — CodeMirror theme
│   │   └── memopad-light.ts     CREATE — CodeMirror theme
│   ├── stores/
│   │   └── theme.ts             CREATE — Zustand store; tests in src/tests/theme.test.ts
│   ├── lib/
│   │   ├── session-debounce.ts  CREATE — wraps sessionSave with debounce
│   │   └── tauri.ts             (unchanged in this phase)
│   ├── components/
│   │   ├── SearchStrip.tsx      CREATE — inline find/replace UI
│   │   ├── Editor.tsx           MODIFY — render SearchStrip + theme-aware
│   │   ├── TitleBar.tsx         MODIFY — read theme for body class
│   │   └── (everything else)    (color literals replaced with CSS vars)
│   ├── commands/
│   │   └── builtins.ts          MODIFY — register find/replace/theme commands
│   ├── index.css                MODIFY — @font-face + import themes.css
│   ├── App.tsx                  MODIFY — wire session-debounce; mount theme css class
│   └── tests/
│       ├── theme.test.ts        CREATE
│       └── session-debounce.test.ts  CREATE
└── tests/e2e/
    ├── find-replace.spec.ts     CREATE
    └── theme.spec.ts            CREATE
```

Boundary intent:

- `stores/theme.ts` owns the single source of truth for "which theme is active." It exposes `useTheme` with `mode: 'light' | 'dark' | 'system'`, an `effective` selector (resolves `system` to the OS preference), and a `set(mode)` action.
- `styles/themes.css` defines CSS variables on `:root.theme-dark` and `:root.theme-light` for app-chrome colors. No component imports it directly — `index.css` imports it.
- `editor/memopad-dark.ts` and `editor/memopad-light.ts` are CodeMirror 6 theme extensions. The Editor picks one based on `useTheme.effective()`.
- `components/SearchStrip.tsx` owns the find/replace UI and dispatches CM6 commands; the only file that imports `@codemirror/search`.
- `lib/session-debounce.ts` wraps `sessionSave` with a 500 ms tail-debounce. App.tsx imports a single `scheduleSessionSave()` function.

---

## Task 1: Bundle identifier rename + manual reset of dev data

**Files:**
- Modify: `src-tauri/tauri.conf.json`

The identifier changes from `dev.memopad.app` to `dev.memopad.editor`. **Side effect:** the app-local-data dir path changes, so any existing journal / session.json under `%APPDATA%\dev.memopad.app\` will become orphaned. Since the only user is the developer (and Phase 4's results doc confirms nothing is installed system-wide), this is safe to change now.

- [ ] **Step 1: Edit src-tauri/tauri.conf.json**

In `src-tauri/tauri.conf.json`, change the `identifier` field:

OLD:
```json
"identifier": "dev.memopad.app",
```

NEW:
```json
"identifier": "dev.memopad.editor",
```

(No other changes in tauri.conf.json.)

- [ ] **Step 2: Verify cargo check**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Set-Location src-tauri
cargo check
Set-Location ..
```
Expected: clean Finished. (Tauri's `app_local_data_dir` resolves at runtime, not compile time.)

- [ ] **Step 3: Delete any old appdata so the dev machine starts fresh**

```powershell
$old = Join-Path $env:APPDATA 'dev.memopad.app'
if (Test-Path $old) { Remove-Item -Recurse -Force $old }
```

(Idempotent — does nothing if the dir doesn't exist.)

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/tauri.conf.json
git commit -m "config: rename bundle identifier to dev.memopad.editor

The old identifier ended in .app, which collides with macOS app-bundle
extensions and would have caused trouble at the first Mac build. No
installed users yet, so rename now."
```

---

## Task 2: Vendor JetBrains Mono and wire @font-face

**Files:**
- Create: `src/assets/fonts/JetBrainsMono-Regular.woff2`
- Create: `src/assets/fonts/JetBrainsMono-Bold.woff2`
- Modify: `src/index.css`

JetBrains Mono is Apache 2.0 licensed. We vendor the regular + bold weights only — that covers the editor and our app chrome. Italics and other weights can be added later if needed.

- [ ] **Step 1: Download the two woff2 files**

Run via PowerShell (downloads from the JetBrains releases CDN):

```powershell
$dir = 'src/assets/fonts'
New-Item -ItemType Directory -Path $dir -Force | Out-Null

# JetBrains Mono v2.304 (current as of 2026) — Apache 2.0
# Source: https://github.com/JetBrains/JetBrainsMono/releases
$base = 'https://github.com/JetBrains/JetBrainsMono/raw/v2.304/fonts/webfonts'
Invoke-WebRequest -Uri "$base/JetBrainsMono-Regular.woff2" -OutFile "$dir/JetBrainsMono-Regular.woff2"
Invoke-WebRequest -Uri "$base/JetBrainsMono-Bold.woff2"    -OutFile "$dir/JetBrainsMono-Bold.woff2"

# Verify both files exist and are larger than 30 KB (sanity)
Get-ChildItem $dir | Format-Table Name, Length
```

Expected: two files printed, each > 30 KB.

If GitHub rate-limits or the URL 404s (versions may have moved), try `https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/webfonts/...` as a fallback. If both fail, install via npm: `npm install --save @fontsource/jetbrains-mono` and adjust the @font-face block below to import from `node_modules/@fontsource/jetbrains-mono/files/...` — but vendored woff2 is preferred (smaller bundle, no node_modules dependency at runtime).

- [ ] **Step 2: Add LICENSE note for the vendored font**

Create `src/assets/fonts/LICENSE.txt`:

```
JetBrains Mono is licensed under the SIL Open Font License 1.1.
See https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt for the full license.
```

(The OFL allows redistribution as long as the license accompanies the font.)

- [ ] **Step 3: Add @font-face declarations to src/index.css**

PREPEND to `src/index.css` (above the existing `@tailwind` directives):

```css
@font-face {
  font-family: 'JetBrains Mono';
  src: url('./assets/fonts/JetBrainsMono-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'JetBrains Mono';
  src: url('./assets/fonts/JetBrainsMono-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
```

Keep everything else in index.css unchanged.

- [ ] **Step 4: Verify Vite picks up the fonts**

```powershell
npm run build 2>&1 | Select-Object -Last 10
```
Expected: build succeeds; the `dist/assets/` directory contains the woff2 files with content-hashed names (Vite copies them).

- [ ] **Step 5: Commit**

```powershell
git add src/assets/fonts/ src/index.css
git commit -m "font: vendor JetBrains Mono regular+bold + @font-face

Editor falls back to system fonts otherwise; bundling makes the
editor look the same on every machine."
```

---

## Task 3: Theme store + Vitest TDD

**Files:**
- Create: `src/stores/theme.ts`
- Create: `src/tests/theme.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/tests/theme.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTheme, effectiveTheme, type ThemeMode } from '../stores/theme';

function setSystemPrefersDark(dark: boolean) {
  // Override window.matchMedia BEFORE importing/using theme. Since the module
  // reads at call-time inside effectiveTheme, this works at any point.
  (window as unknown as { matchMedia?: typeof window.matchMedia }).matchMedia = ((query: string) => {
    return {
      matches: query.includes('dark') ? dark : !dark,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

describe('theme store', () => {
  beforeEach(() => {
    useTheme.getState().reset();
  });

  it('default mode is "system"', () => {
    expect(useTheme.getState().mode).to.equal('system');
  });

  it('set("dark") changes mode', () => {
    useTheme.getState().set('dark');
    expect(useTheme.getState().mode).to.equal('dark');
  });

  it('effectiveTheme("dark") returns "dark"', () => {
    expect(effectiveTheme('dark')).to.equal('dark');
  });

  it('effectiveTheme("light") returns "light"', () => {
    expect(effectiveTheme('light')).to.equal('light');
  });

  it('effectiveTheme("system") follows window.matchMedia prefers-color-scheme: dark', () => {
    setSystemPrefersDark(true);
    expect(effectiveTheme('system')).to.equal('dark');
    setSystemPrefersDark(false);
    expect(effectiveTheme('system')).to.equal('light');
  });

  it('effectiveTheme handles missing matchMedia gracefully (defaults to dark)', () => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    expect(effectiveTheme('system')).to.equal('dark');
  });

  it('toggle cycles dark → light → system → dark', () => {
    useTheme.getState().set('dark');
    useTheme.getState().toggle();
    expect(useTheme.getState().mode).to.equal('light');
    useTheme.getState().toggle();
    expect(useTheme.getState().mode).to.equal('system');
    useTheme.getState().toggle();
    expect(useTheme.getState().mode).to.equal('dark');
  });

  type _ModeIsExported = ThemeMode;
  void (null as unknown as _ModeIsExported);
});
```

- [ ] **Step 2: Run — confirm failure**

```powershell
npm test
```
Expected: cannot find module `../stores/theme`.

- [ ] **Step 3: Implement**

Create `src/stores/theme.ts`:

```ts
import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeState {
  mode: ThemeMode;
  set: (mode: ThemeMode) => void;
  toggle: () => void;
  reset: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: 'system',
  set: (mode) => set({ mode }),
  toggle: () => {
    const order: ThemeMode[] = ['dark', 'light', 'system'];
    const idx = order.indexOf(get().mode);
    set({ mode: order[(idx + 1) % order.length] });
  },
  reset: () => set({ mode: 'system' }),
}));

/**
 * Resolve a ThemeMode to a concrete 'light' or 'dark'.
 * 'system' consults window.matchMedia. Defaults to 'dark' if matchMedia is unavailable.
 */
export function effectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  const mm = (window as unknown as { matchMedia?: (q: string) => MediaQueryList }).matchMedia;
  if (!mm) return 'dark';
  return mm('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
```

- [ ] **Step 4: Run — confirm pass**

```powershell
npm test
```
Expected: existing 32 + 7 new theme tests = **39 passing**.

- [ ] **Step 5: Commit**

```powershell
git add src/stores/theme.ts src/tests/theme.test.ts
git commit -m "theme: store with system/dark/light modes + effectiveTheme resolver"
```

---

## Task 4: CSS variables + app-chrome theme switch

**Files:**
- Create: `src/styles/themes.css`
- Modify: `src/index.css` (import + add `.theme-*` class on html)
- Modify: `src/components/TitleBar.tsx` (use vars)
- Modify: `src/components/TabStrip.tsx` (use vars)
- Modify: `src/components/StatusBar.tsx` (use vars)
- Modify: `src/App.tsx` (set the `theme-*` class on `<html>` from useTheme)

We replace the Tailwind `bg-neutral-900` / `border-neutral-800` / `text-neutral-*` color tokens that are repeated across chrome components with CSS variables. Tailwind utility classes that don't relate to color (`flex`, `h-9`, `w-full`, etc.) stay as-is. Tailwind's arbitrary-value syntax `bg-[var(--app-bg)]` makes this drop-in.

- [ ] **Step 1: Create src/styles/themes.css**

EXACT contents:
```css
/* Warm-neutral palettes — Memopad Dark / Memopad Light. */

:root.theme-dark {
  --app-bg: #1a1a1c;
  --app-bg-elevated: #232325;
  --app-border: #2e2e30;
  --app-fg: #e8e6e3;
  --app-fg-muted: #a09e9b;
  --app-fg-dim: #6b6966;
  --app-accent: #f3c969;        /* warm amber dirty dot / active tab underline */
  --app-accent-text: #1a1a1c;
  --app-danger: #d97a6c;
  --app-tab-active-bg: #131315;
  --app-tab-hover-bg: rgba(255, 255, 255, 0.04);
}

:root.theme-light {
  --app-bg: #faf8f4;
  --app-bg-elevated: #f1ede4;
  --app-border: #d9d2c2;
  --app-fg: #2b2926;
  --app-fg-muted: #6b6966;
  --app-fg-dim: #a09e9b;
  --app-accent: #b9892e;
  --app-accent-text: #faf8f4;
  --app-danger: #b85a4a;
  --app-tab-active-bg: #ffffff;
  --app-tab-hover-bg: rgba(0, 0, 0, 0.04);
}
```

- [ ] **Step 2: Import themes.css from src/index.css**

PREPEND to `src/index.css` (after the `@font-face` blocks, before the `@tailwind` directives):

```css
@import './styles/themes.css';
```

- [ ] **Step 3: Default `<html>` theme class in index.html**

The Vite entry `index.html` already has `<html lang="en">`. Edit it so the root html starts as `theme-dark` (effectively the system default until JS runs):

OLD:
```html
<html lang="en">
```

NEW:
```html
<html lang="en" class="theme-dark">
```

- [ ] **Step 4: Update src/App.tsx to set the class from useTheme**

In `src/App.tsx`, locate the `import { useBuffers } from './stores/buffers';` line. ADD a new import below it:

```tsx
import { useTheme, effectiveTheme } from './stores/theme';
```

Then, INSIDE the App component body (top of function, before `useEffect`), ADD:

```tsx
  const themeMode = useTheme((s) => s.mode);
  useEffect(() => {
    const cls = effectiveTheme(themeMode) === 'dark' ? 'theme-dark' : 'theme-light';
    document.documentElement.classList.remove('theme-dark', 'theme-light');
    document.documentElement.classList.add(cls);
  }, [themeMode]);
```

(Keep the existing `useEffect` blocks below this new one.)

- [ ] **Step 5: Update TitleBar.tsx — swap color tokens to vars**

Overwrite `src/components/TitleBar.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TabStrip } from './TabStrip';

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;
    invoke<boolean>('window_is_maximized')
      .then((v) => mounted && setMaximized(v))
      .catch(() => {});

    const unlistenPromise = getCurrentWindow().onResized(async () => {
      const v = await invoke<boolean>('window_is_maximized').catch(() => false);
      if (mounted) setMaximized(v);
    });

    return () => {
      mounted = false;
      unlistenPromise.then((un) => un()).catch(() => {});
    };
  }, []);

  return (
    <div
      className="drag-region flex h-9 select-none items-center justify-between border-b"
      style={{ background: 'var(--app-bg)', borderColor: 'var(--app-border)', color: 'var(--app-fg-muted)' }}
    >
      <button
        type="button"
        className="no-drag flex h-full w-9 items-center justify-center text-base"
        style={{ color: 'var(--app-fg-muted)' }}
        aria-label="App menu"
      >
        ≡
      </button>

      <div className="no-drag flex-1 overflow-hidden">
        <TabStrip />
      </div>

      <div className="no-drag flex h-full">
        <button
          type="button"
          aria-label="Minimize"
          className="flex h-full w-11 items-center justify-center hover:opacity-70"
          onClick={() => invoke('window_minimize').catch(console.error)}
        >
          &#x2013;
        </button>
        <button
          type="button"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          className="flex h-full w-11 items-center justify-center hover:opacity-70"
          onClick={() => invoke('window_toggle_maximize').catch(console.error)}
        >
          {maximized ? '❐' : '☐'}
        </button>
        <button
          type="button"
          aria-label="Close"
          className="flex h-full w-11 items-center justify-center hover:text-white"
          style={{ }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--app-danger)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
          onClick={() => invoke('window_close').catch(console.error)}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
```

(Tailwind alone can't reference CSS variables for `hover:bg-*` without arbitrary-value syntax; using inline `style` handlers for the danger-hover keeps the diff minimal.)

- [ ] **Step 6: Update TabStrip.tsx — vars**

Open `src/components/TabStrip.tsx`. Find the className block on the tab `<div>`:

OLD section (the long className expression):
```tsx
className={
  'group flex h-full max-w-[200px] cursor-pointer items-center gap-1 border-r border-neutral-800 px-3 text-xs '
  + (isActive
    ? 'bg-neutral-950 text-neutral-100 shadow-[inset_0_-2px_0_0_theme(colors.amber.400)]'
    : 'text-neutral-400 hover:bg-neutral-800/60')
  + (dragId === b.id ? ' opacity-50' : '')
}
```

Replace with:
```tsx
className={
  'group flex h-full max-w-[200px] cursor-pointer items-center gap-1 border-r px-3 text-xs '
  + (isActive
    ? 'shadow-[inset_0_-2px_0_0_var(--app-accent)]'
    : '')
  + (dragId === b.id ? ' opacity-50' : '')
}
style={{
  borderColor: 'var(--app-border)',
  background: isActive ? 'var(--app-tab-active-bg)' : undefined,
  color: isActive ? 'var(--app-fg)' : 'var(--app-fg-muted)',
}}
```

Also locate the "no buffers" empty branch:
```tsx
return (
  <div className="flex h-full items-center justify-center text-xs tracking-wide text-neutral-500">
    Memopad
  </div>
);
```

Replace `text-neutral-500` with inline `style`:
```tsx
return (
  <div
    className="flex h-full items-center justify-center text-xs tracking-wide"
    style={{ color: 'var(--app-fg-dim)' }}
  >
    Memopad
  </div>
);
```

And the dirty dot span:
```tsx
{b.dirty && (
  <span aria-label="Unsaved changes" className="text-amber-400">●</span>
)}
```

Replace with:
```tsx
{b.dirty && (
  <span aria-label="Unsaved changes" style={{ color: 'var(--app-accent)' }}>●</span>
)}
```

- [ ] **Step 7: Update StatusBar.tsx — vars**

Open `src/components/StatusBar.tsx`. Replace the two divs that have color classes:

The empty-state div:
```tsx
return <div className="h-6 border-t border-neutral-800 bg-neutral-900" />;
```

becomes:
```tsx
return <div className="h-6 border-t" style={{ borderColor: 'var(--app-border)', background: 'var(--app-bg)' }} />;
```

The main bar:
```tsx
<div className="flex h-6 select-none items-center gap-3 border-t border-neutral-800 bg-neutral-900 px-3 text-[11px] text-neutral-400">
```

becomes:
```tsx
<div
  className="flex h-6 select-none items-center gap-3 border-t px-3 text-[11px]"
  style={{ borderColor: 'var(--app-border)', background: 'var(--app-bg)', color: 'var(--app-fg-muted)' }}
>
```

- [ ] **Step 8: Verify build + commit**

```powershell
npx tsc --noEmit
npm test
git add src/styles/themes.css src/index.css index.html src/App.tsx src/components/TitleBar.tsx src/components/TabStrip.tsx src/components/StatusBar.tsx
git commit -m "theme: CSS variables for app chrome; html.theme-* class from useTheme"
```

---

## Task 5: Memopad Dark + Memopad Light CodeMirror themes

**Files:**
- Create: `src/editor/memopad-dark.ts`
- Create: `src/editor/memopad-light.ts`
- Modify: `src/components/Editor.tsx` (pick theme based on useTheme)

These are warm-neutral takes on CodeMirror's `oneDark` and a light counterpart. We import the upstream themes for syntax-color tokens we don't want to redesign from scratch, then override the chrome (background, gutter, selection, cursor) to match our CSS variables.

- [ ] **Step 1: Create src/editor/memopad-dark.ts**

EXACT contents:
```ts
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

const palette = {
  bg: '#1a1a1c',
  bgElevated: '#232325',
  fg: '#e8e6e3',
  fgMuted: '#a09e9b',
  fgDim: '#6b6966',
  cursor: '#f3c969',
  selection: '#3a3527',
  selectionMatch: '#46402b',
  keyword: '#d6a86c',
  string: '#a3c08c',
  number: '#c9a06c',
  comment: '#6b6966',
  variable: '#e8e6e3',
  function: '#82a8c6',
  type: '#c69cc4',
};

const editorTheme = EditorView.theme(
  {
    '&': {
      color: palette.fg,
      backgroundColor: palette.bg,
    },
    '.cm-content': {
      caretColor: palette.cursor,
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: palette.cursor },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: palette.selection },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-gutters': {
      backgroundColor: palette.bg,
      color: palette.fgDim,
      border: 'none',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: palette.fgMuted },
    '.cm-selectionMatch': { backgroundColor: palette.selectionMatch },
    '.cm-searchMatch': { backgroundColor: '#5e4f1f', outline: '1px solid #f3c969' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#8b6b1f' },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: palette.keyword },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: palette.variable },
  { tag: [t.function(t.variableName), t.labelName], color: palette.function },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: palette.number },
  { tag: [t.definition(t.name), t.separator], color: palette.fg },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: palette.type },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: palette.keyword },
  { tag: [t.meta, t.comment], color: palette.comment, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.heading, fontWeight: '700', color: palette.keyword },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: palette.number },
  { tag: [t.processingInstruction, t.string, t.inserted], color: palette.string },
  { tag: t.invalid, color: palette.cursor },
]);

export const memopadDark: Extension = [editorTheme, syntaxHighlighting(highlight)];
```

- [ ] **Step 2: Create src/editor/memopad-light.ts**

EXACT contents:
```ts
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

const palette = {
  bg: '#faf8f4',
  bgElevated: '#f1ede4',
  fg: '#2b2926',
  fgMuted: '#6b6966',
  fgDim: '#a09e9b',
  cursor: '#b9892e',
  selection: '#f0e2b4',
  selectionMatch: '#e7d28a',
  keyword: '#9e5a14',
  string: '#5b7a3c',
  number: '#8a5a14',
  comment: '#a09e9b',
  variable: '#2b2926',
  function: '#2f6b94',
  type: '#7a3e76',
};

const editorTheme = EditorView.theme(
  {
    '&': {
      color: palette.fg,
      backgroundColor: palette.bg,
    },
    '.cm-content': {
      caretColor: palette.cursor,
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: palette.cursor },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: palette.selection },
    '.cm-activeLine': { backgroundColor: 'rgba(0,0,0,0.03)' },
    '.cm-gutters': {
      backgroundColor: palette.bg,
      color: palette.fgDim,
      border: 'none',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: palette.fgMuted },
    '.cm-selectionMatch': { backgroundColor: palette.selectionMatch },
    '.cm-searchMatch': { backgroundColor: '#f4dca6', outline: '1px solid #b9892e' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#e9c674' },
  },
  { dark: false },
);

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: palette.keyword },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: palette.variable },
  { tag: [t.function(t.variableName), t.labelName], color: palette.function },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: palette.number },
  { tag: [t.definition(t.name), t.separator], color: palette.fg },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: palette.type },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: palette.keyword },
  { tag: [t.meta, t.comment], color: palette.comment, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.heading, fontWeight: '700', color: palette.keyword },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: palette.number },
  { tag: [t.processingInstruction, t.string, t.inserted], color: palette.string },
  { tag: t.invalid, color: palette.cursor },
]);

export const memopadLight: Extension = [editorTheme, syntaxHighlighting(highlight)];
```

- [ ] **Step 3: Wire Editor.tsx to pick theme**

Open `src/components/Editor.tsx`. Replace the existing imports and theme constant. Current top of the file is:

```tsx
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
```

Replace with:

```tsx
import CodeMirror from '@uiw/react-codemirror';
import { useTheme, effectiveTheme } from '../stores/theme';
import { memopadDark } from '../editor/memopad-dark';
import { memopadLight } from '../editor/memopad-light';
```

Inside the `Editor` function body, BEFORE the early-return for no active buffer, ADD:

```tsx
  const themeMode = useTheme((s) => s.mode);
  const themeExt = effectiveTheme(themeMode) === 'dark' ? memopadDark : memopadLight;
```

Then in the `<CodeMirror>` JSX, replace `theme={oneDark}` with `theme={undefined}` and add `themeExt` to the extensions array:

OLD:
```tsx
<CodeMirror
  key={active.id}
  value={active.content}
  height="100%"
  style={{ height: '100%' }}
  theme={oneDark}
  extensions={[editorTheme, ...languageForPath(active.path)]}
```

NEW:
```tsx
<CodeMirror
  key={active.id}
  value={active.content}
  height="100%"
  style={{ height: '100%' }}
  extensions={[editorTheme, themeExt, ...languageForPath(active.path)]}
```

(Drop the `theme` prop entirely — we provide the theme via the `extensions` array now.)

Tip: keep the existing `editorTheme` (the font-family override) — it's still useful; it applies above the new theme.

- [ ] **Step 4: Verify build + commit**

```powershell
npx tsc --noEmit
npm test
git add src/editor/memopad-dark.ts src/editor/memopad-light.ts src/components/Editor.tsx
git commit -m "theme: Memopad Dark + Light editor themes; Editor picks from useTheme"
```

---

## Task 6: Register theme commands in the palette

**Files:**
- Modify: `src/commands/builtins.ts`

- [ ] **Step 1: Add theme commands to builtins.ts**

In `src/commands/builtins.ts`, find the bottom of the `registerBuiltins` function (just before its closing `}`). Add an import at the top of the file (near the existing imports):

```ts
import { useTheme } from '../stores/theme';
```

Then INSIDE `registerBuiltins`, append:

```ts
  register({
    id: 'theme.toggle',
    title: 'View: Toggle Theme (Dark / Light / System)',
    run: () => useTheme.getState().toggle(),
  });
  register({
    id: 'theme.dark',
    title: 'View: Use Dark Theme',
    run: () => useTheme.getState().set('dark'),
  });
  register({
    id: 'theme.light',
    title: 'View: Use Light Theme',
    run: () => useTheme.getState().set('light'),
  });
  register({
    id: 'theme.system',
    title: 'View: Use System Theme',
    run: () => useTheme.getState().set('system'),
  });
```

- [ ] **Step 2: Verify TS + commit**

```powershell
npx tsc --noEmit
git add src/commands/builtins.ts
git commit -m "theme: register View commands in the palette"
```

---

## Task 7: Session-save debounce — TDD

**Files:**
- Create: `src/lib/session-debounce.ts`
- Create: `src/tests/session-debounce.test.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/tests/session-debounce.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const saveSpy = vi.fn();
vi.mock('../lib/tauri', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/tauri')>();
  return {
    ...original,
    sessionSave: (state: unknown) => {
      saveSpy(state);
      return Promise.resolve();
    },
  };
});

import { scheduleSessionSave, SESSION_DEBOUNCE_MS, flushSessionSave } from '../lib/session-debounce';

describe('session-debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveSpy.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules a save after SESSION_DEBOUNCE_MS', () => {
    scheduleSessionSave({ tabs: [], active_id: null });
    expect(saveSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SESSION_DEBOUNCE_MS);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('coalesces rapid calls into one save with the latest payload', () => {
    scheduleSessionSave({ tabs: [{ buffer_id: 'a', path: null }], active_id: 'a' });
    vi.advanceTimersByTime(100);
    scheduleSessionSave({ tabs: [{ buffer_id: 'a', path: null }, { buffer_id: 'b', path: null }], active_id: 'b' });
    vi.advanceTimersByTime(100);
    scheduleSessionSave({ tabs: [{ buffer_id: 'c', path: null }], active_id: 'c' });
    vi.advanceTimersByTime(SESSION_DEBOUNCE_MS);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const last = saveSpy.mock.calls[0][0] as { active_id: string };
    expect(last.active_id).to.equal('c');
  });

  it('flushSessionSave runs the pending save immediately', async () => {
    scheduleSessionSave({ tabs: [], active_id: null });
    expect(saveSpy).not.toHaveBeenCalled();
    await flushSessionSave();
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('flushSessionSave is a no-op when no save is pending', async () => {
    await flushSessionSave();
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — confirm failure**

```powershell
npm test
```
Expected: cannot find module `../lib/session-debounce`.

- [ ] **Step 3: Implement**

Create `src/lib/session-debounce.ts`:

```ts
import { sessionSave, type SessionState } from './tauri';

export const SESSION_DEBOUNCE_MS = 500;

let pendingTimer: ReturnType<typeof setTimeout> | undefined;
let pendingState: SessionState | undefined;

function fire() {
  if (!pendingState) return;
  const state = pendingState;
  pendingState = undefined;
  pendingTimer = undefined;
  sessionSave(state).catch((err) => {
    console.error('sessionSave failed:', err);
  });
}

/** Schedule a session save after SESSION_DEBOUNCE_MS of idle. Coalesces. */
export function scheduleSessionSave(state: SessionState): void {
  pendingState = state;
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(fire, SESSION_DEBOUNCE_MS);
}

/** Run any pending save right now. Resolves once the save IPC completes. */
export async function flushSessionSave(): Promise<void> {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = undefined;
  }
  if (!pendingState) return;
  const state = pendingState;
  pendingState = undefined;
  await sessionSave(state);
}
```

- [ ] **Step 4: Run — confirm pass**

```powershell
npm test
```
Expected: 39 (existing) + 4 (debounce) = **43 passing**.

- [ ] **Step 5: Wire src/App.tsx to use scheduleSessionSave**

In `src/App.tsx`, replace the inline `persistSession` helper. Locate:

```tsx
async function persistSession() {
  const state = useBuffers.getState();
  await sessionSave({
    tabs: state.buffers.map((b) => ({ buffer_id: b.id, path: b.path })),
    active_id: state.activeId,
  });
}
```

Replace with:

```tsx
function persistSession() {
  const state = useBuffers.getState();
  scheduleSessionSave({
    tabs: state.buffers.map((b) => ({ buffer_id: b.id, path: b.path })),
    active_id: state.activeId,
  });
}
```

Update the import line at the top of `src/App.tsx`. Locate:

```tsx
import { sessionSave, statFile } from './lib/tauri';
```

Change to:

```tsx
import { statFile } from './lib/tauri';
import { scheduleSessionSave } from './lib/session-debounce';
```

The `useBuffers.subscribe(...)` callback in App.tsx already calls `persistSession()`; with the rewrite it now schedules a debounced save. No other changes needed.

- [ ] **Step 6: TS check + commit**

```powershell
npx tsc --noEmit
git add src/lib/session-debounce.ts src/tests/session-debounce.test.ts src/App.tsx
git commit -m "session: 500ms tail-debounce; App.tsx schedules instead of awaiting"
```

---

## Task 8: SearchStrip component scaffold

**Files:**
- Create: `src/components/SearchStrip.tsx`

The SearchStrip is the find/replace UI that lives at the top of the editor area. It is controlled — visibility is owned by a Zustand-style hook or App-level state. For v1, we host the visibility flag inside the SearchStrip's parent (Editor.tsx) and pass `open` + `mode` ('find' | 'replace') + `onClose`.

The component takes a callback to dispatch CM6 search commands. We do not import CodeMirror APIs in this file — Editor.tsx will pass the EditorView ref + helpers.

- [ ] **Step 1: Create the component**

EXACT contents of `src/components/SearchStrip.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';

export interface SearchStripActions {
  /** Find next match. Returns true if a match exists. */
  findNext: () => boolean;
  /** Find previous match. Returns true if a match exists. */
  findPrev: () => boolean;
  /** Replace current match with replacement. Returns true if a match was replaced. */
  replaceCurrent: () => boolean;
  /** Replace all matches. Returns the number of replacements. */
  replaceAll: () => number;
  /** Update the underlying search query/options. */
  setQuery: (query: string, opts: { regex: boolean; caseSensitive: boolean; replace: string }) => void;
  /** Return current match info: { current: 1-based index or 0, total } */
  matchInfo: () => { current: number; total: number };
  /** Clear all match highlights. */
  clear: () => void;
}

interface Props {
  open: boolean;
  mode: 'find' | 'replace';
  onClose: () => void;
  actions: SearchStripActions | null;
}

export function SearchStrip({ open, mode, onClose, actions }: Props) {
  const [query, setQuery] = useState('');
  const [replace, setReplace] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const findInputRef = useRef<HTMLInputElement>(null);

  // Push every search-state change to the underlying editor.
  useEffect(() => {
    if (!actions || !open) return;
    actions.setQuery(query, { regex, caseSensitive, replace });
    setMatches(actions.matchInfo());
  }, [query, replace, regex, caseSensitive, actions, open]);

  // On open, focus the find input.
  useEffect(() => {
    if (open) findInputRef.current?.focus();
  }, [open]);

  // On close, clear highlights.
  useEffect(() => {
    if (!open && actions) actions.clear();
  }, [open, actions]);

  if (!open) return null;

  const onFindKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) actions?.findPrev(); else actions?.findNext();
      if (actions) setMatches(actions.matchInfo());
      return;
    }
  };

  const onReplaceKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      actions?.replaceCurrent();
      if (actions) setMatches(actions.matchInfo());
    }
  };

  return (
    <div
      data-search-strip
      className="flex items-center gap-2 border-b px-2 py-1 text-xs"
      style={{ background: 'var(--app-bg-elevated)', borderColor: 'var(--app-border)', color: 'var(--app-fg)' }}
    >
      <input
        ref={findInputRef}
        data-search-find-input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onFindKey}
        placeholder="Find"
        className="flex-1 rounded px-2 py-1 focus:outline-none"
        style={{ background: 'var(--app-bg)', color: 'var(--app-fg)', border: '1px solid var(--app-border)' }}
      />
      {mode === 'replace' && (
        <input
          data-search-replace-input
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
          onKeyDown={onReplaceKey}
          placeholder="Replace"
          className="flex-1 rounded px-2 py-1 focus:outline-none"
          style={{ background: 'var(--app-bg)', color: 'var(--app-fg)', border: '1px solid var(--app-border)' }}
        />
      )}
      <span
        data-search-match-count
        className="min-w-[60px] text-right"
        style={{ color: matches.total ? 'var(--app-fg-muted)' : 'var(--app-fg-dim)' }}
      >
        {matches.total === 0 ? 'No matches' : `${matches.current} / ${matches.total}`}
      </span>
      <button
        type="button"
        aria-label="Toggle regex"
        aria-pressed={regex}
        onClick={() => setRegex((v) => !v)}
        className="rounded px-2 py-0.5"
        style={{
          border: '1px solid var(--app-border)',
          background: regex ? 'var(--app-accent)' : 'transparent',
          color: regex ? 'var(--app-accent-text)' : 'var(--app-fg-muted)',
        }}
        title="Regex"
      >
        .*
      </button>
      <button
        type="button"
        aria-label="Toggle case sensitive"
        aria-pressed={caseSensitive}
        onClick={() => setCaseSensitive((v) => !v)}
        className="rounded px-2 py-0.5"
        style={{
          border: '1px solid var(--app-border)',
          background: caseSensitive ? 'var(--app-accent)' : 'transparent',
          color: caseSensitive ? 'var(--app-accent-text)' : 'var(--app-fg-muted)',
        }}
        title="Case sensitive"
      >
        Aa
      </button>
      {mode === 'replace' && (
        <button
          type="button"
          aria-label="Replace all"
          onClick={() => {
            actions?.replaceAll();
            if (actions) setMatches(actions.matchInfo());
          }}
          className="rounded px-2 py-0.5"
          style={{ border: '1px solid var(--app-border)', color: 'var(--app-fg)' }}
        >
          Replace all
        </button>
      )}
      <button
        type="button"
        aria-label="Close find"
        onClick={onClose}
        className="rounded px-2 py-0.5"
        style={{ color: 'var(--app-fg-muted)' }}
      >
        &times;
      </button>
    </div>
  );
}
```

- [ ] **Step 2: TS check**

```powershell
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```powershell
git add src/components/SearchStrip.tsx
git commit -m "ui(search): SearchStrip component scaffold (no editor wiring yet)"
```

---

## Task 9: Wire SearchStrip into Editor.tsx using CodeMirror @codemirror/search

**Files:**
- Modify: `src/components/Editor.tsx`

`@codemirror/search` is already a transitive dep through `@uiw/react-codemirror`. Confirm or install:

- [ ] **Step 1: Confirm @codemirror/search is available**

```powershell
node -e "require('@codemirror/search')" 2>&1 | Select-Object -Last 5
```

If it prints nothing (no error), it's available. If it errors with "Cannot find module", install:
```powershell
npm install "@codemirror/search@^6"
```

- [ ] **Step 2: Overwrite src/components/Editor.tsx**

EXACT contents:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import {
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  getSearchQuery,
} from '@codemirror/search';
import { useBuffers, selectActive } from '../stores/buffers';
import { languageForPath } from '../lib/language';
import { useTheme, effectiveTheme } from '../stores/theme';
import { memopadDark } from '../editor/memopad-dark';
import { memopadLight } from '../editor/memopad-light';
import { ExternalChangeBanner } from './ExternalChangeBanner';
import { SearchStrip, type SearchStripActions } from './SearchStrip';

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace' },
  '.cm-content': { padding: '8px 0' },
});

interface SearchPanelState {
  open: boolean;
  mode: 'find' | 'replace';
}

declare global {
  // eslint-disable-next-line no-var
  var __memopadSearchPanel: { open: (mode: 'find' | 'replace') => void } | undefined;
}

export function Editor() {
  const active = useBuffers(selectActive);
  const setActiveContent = useBuffers((s) => s.setActiveContent);
  const themeMode = useTheme((s) => s.mode);
  const themeExt = effectiveTheme(themeMode) === 'dark' ? memopadDark : memopadLight;

  const viewRef = useRef<EditorView | null>(null);
  const [searchPanel, setSearchPanel] = useState<SearchPanelState>({ open: false, mode: 'find' });

  // Expose a global "open search panel" handle so App.tsx keyboard handler can trigger it.
  useEffect(() => {
    globalThis.__memopadSearchPanel = {
      open: (mode) => setSearchPanel({ open: true, mode }),
    };
    return () => {
      globalThis.__memopadSearchPanel = undefined;
    };
  }, []);

  const actions: SearchStripActions = {
    findNext: () => {
      const v = viewRef.current;
      if (!v) return false;
      return findNext(v);
    },
    findPrev: () => {
      const v = viewRef.current;
      if (!v) return false;
      return findPrevious(v);
    },
    replaceCurrent: () => {
      const v = viewRef.current;
      if (!v) return false;
      return replaceNext(v);
    },
    replaceAll: () => {
      const v = viewRef.current;
      if (!v) return 0;
      const before = countMatches(v);
      replaceAll(v);
      return before;
    },
    setQuery: (query, opts) => {
      const v = viewRef.current;
      if (!v) return;
      v.dispatch({
        effects: setSearchQuery.of(
          new SearchQuery({
            search: query,
            replace: opts.replace,
            regexp: opts.regex,
            caseSensitive: opts.caseSensitive,
          }),
        ),
      });
    },
    matchInfo: () => {
      const v = viewRef.current;
      if (!v) return { current: 0, total: 0 };
      return computeMatchInfo(v);
    },
    clear: () => {
      const v = viewRef.current;
      if (!v) return;
      v.dispatch({
        effects: setSearchQuery.of(new SearchQuery({ search: '' })),
      });
    },
  };

  const closePanel = useCallback(() => {
    setSearchPanel((s) => ({ ...s, open: false }));
  }, []);

  if (!active) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs" style={{ color: 'var(--app-fg-dim)' }}>
        Ctrl+O to open · Ctrl+N to start typing
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <ExternalChangeBanner />
      <SearchStrip
        open={searchPanel.open}
        mode={searchPanel.mode}
        onClose={closePanel}
        actions={searchPanel.open ? actions : null}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeMirror
          key={active.id}
          value={active.content}
          height="100%"
          style={{ height: '100%' }}
          extensions={[
            editorTheme,
            themeExt,
            ...languageForPath(active.path),
          ]}
          onChange={setActiveContent}
          onCreateEditor={(view) => {
            viewRef.current = view;
          }}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: false,
            indentOnInput: true,
          }}
        />
      </div>
    </div>
  );
}

/** Count total matches in the document for the current search query. */
function countMatches(view: EditorView): number {
  const query = getSearchQuery(view.state);
  const text = view.state.doc.toString();
  if (!query.search) return 0;
  try {
    const re = query.regexp
      ? new RegExp(query.search, query.caseSensitive ? 'g' : 'gi')
      : new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), query.caseSensitive ? 'g' : 'gi');
    let count = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      count += 1;
      // Guard against infinite loop on zero-width matches (e.g. /^/g).
      if (re.lastIndex === m.index) re.lastIndex += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

/** Compute { current, total } match position for UI display. */
function computeMatchInfo(view: EditorView): { current: number; total: number } {
  const total = countMatches(view);
  if (total === 0) return { current: 0, total: 0 };
  const query = getSearchQuery(view.state);
  if (!query.search) return { current: 0, total };
  const text = view.state.doc.toString();
  const caret = view.state.selection.main.from;
  try {
    const re = query.regexp
      ? new RegExp(query.search, query.caseSensitive ? 'g' : 'gi')
      : new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), query.caseSensitive ? 'g' : 'gi');
    let n = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      n += 1;
      if (m.index >= caret) return { current: n, total };
      if (re.lastIndex === m.index) re.lastIndex += 1;
    }
    return { current: total, total };
  } catch {
    return { current: 0, total };
  }
}
```

- [ ] **Step 3: TS check**

```powershell
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```powershell
git add src/components/Editor.tsx
git commit -m "ui(search): wire SearchStrip to CodeMirror @codemirror/search effects"
```

---

## Task 10: Ctrl+F / Ctrl+H keybindings + palette commands

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/commands/builtins.ts`

- [ ] **Step 1: Add Ctrl+F / Ctrl+H handling in App.tsx**

In `src/App.tsx`, find the keydown handler (inside the second `useEffect`). Add two new branches BEFORE the `key === 'k'` / `key === 'p'` palette branches:

```tsx
      if (key === 'f' && !e.shiftKey) {
        e.preventDefault();
        globalThis.__memopadSearchPanel?.open('find');
        return;
      }
      if (key === 'h' && !e.shiftKey) {
        e.preventDefault();
        globalThis.__memopadSearchPanel?.open('replace');
        return;
      }
```

(The `globalThis.__memopadSearchPanel` handle is set up by Editor.tsx — see Task 9 step 2.)

- [ ] **Step 2: Add palette commands**

In `src/commands/builtins.ts`, append inside `registerBuiltins`:

```ts
  register({
    id: 'edit.find',
    title: 'Edit: Find',
    shortcut: 'Ctrl+F',
    run: () => globalThis.__memopadSearchPanel?.open('find'),
  });
  register({
    id: 'edit.replace',
    title: 'Edit: Replace',
    shortcut: 'Ctrl+H',
    run: () => globalThis.__memopadSearchPanel?.open('replace'),
  });
```

- [ ] **Step 3: TS check + commit**

```powershell
npx tsc --noEmit
git add src/App.tsx src/commands/builtins.ts
git commit -m "search: Ctrl+F / Ctrl+H keybindings + palette commands"
```

---

## Task 11: E2E specs — find/replace + theme switching

**Files:**
- Create: `tests/e2e/find-replace.spec.ts`
- Create: `tests/e2e/theme.spec.ts`

- [ ] **Step 1: Create tests/e2e/find-replace.spec.ts**

EXACT contents:

```ts
import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('find/replace', () => {
  beforeEach(async () => {
    await exec(() => {
      const w = window as unknown as {
        __memopadTestReset: () => void;
        __memopadTestNewBuffer: () => string;
        __memopadTestSetContent: (s: string) => void;
      };
      w.__memopadTestReset();
      w.__memopadTestNewBuffer();
      w.__memopadTestSetContent('foo bar foo baz foo');
    });
    await sleep(200);
  });

  it('Ctrl+F opens the find strip and focuses the input', async () => {
    await getBrowser().keys(['Control', 'f']);
    await sleep(200);
    const stripPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-search-strip]');`,
    );
    expect(stripPresent).to.equal(true);
    const focusOnFind = await classicExecute<boolean>(
      `return document.activeElement === document.querySelector('[data-search-find-input]');`,
    );
    expect(focusOnFind).to.equal(true);
    await getBrowser().keys('Escape');
  });

  it('typing in the find input updates the match count', async () => {
    await getBrowser().keys(['Control', 'f']);
    await sleep(200);
    await classicExecute<void>(
      `var inp = document.querySelector('[data-search-find-input]');
       inp.focus();
       inp.value = 'foo';
       inp.dispatchEvent(new Event('input', { bubbles: true }));
       return undefined;`,
    );
    await sleep(300);
    const count = await classicExecute<string>(
      `return document.querySelector('[data-search-match-count]').textContent;`,
    );
    expect(count).to.match(/\d+\s*\/\s*3/);
    await getBrowser().keys('Escape');
  });

  it('Ctrl+H opens the replace strip with both inputs', async () => {
    await getBrowser().keys(['Control', 'h']);
    await sleep(200);
    const hasFind = await classicExecute<boolean>(
      `return !!document.querySelector('[data-search-find-input]');`,
    );
    const hasReplace = await classicExecute<boolean>(
      `return !!document.querySelector('[data-search-replace-input]');`,
    );
    expect(hasFind).to.equal(true);
    expect(hasReplace).to.equal(true);
    await getBrowser().keys('Escape');
  });

  it('Replace all changes every occurrence (spec acceptance #5)', async () => {
    await getBrowser().keys(['Control', 'h']);
    await sleep(200);
    // Fill find + replace via DOM dispatch (more reliable than keys).
    await classicExecute<void>(
      `var f = document.querySelector('[data-search-find-input]');
       var r = document.querySelector('[data-search-replace-input]');
       f.value = 'foo'; f.dispatchEvent(new Event('input', { bubbles: true }));
       r.value = 'qux'; r.dispatchEvent(new Event('input', { bubbles: true }));
       return undefined;`,
    );
    await sleep(300);
    // Click "Replace all" button.
    await classicExecute<void>(
      `var btn = Array.from(document.querySelectorAll('[data-search-strip] button'))
         .find(b => b.getAttribute('aria-label') === 'Replace all');
       if (btn) btn.click();
       return undefined;`,
    );
    await sleep(300);
    const content = await exec(() => {
      const w = window as unknown as { __memopadTestGetContent: () => string };
      return w.__memopadTestGetContent();
    });
    expect(content).to.equal('qux bar qux baz qux');
    await getBrowser().keys('Escape');
  });

  it('Escape closes the find strip', async () => {
    await getBrowser().keys(['Control', 'f']);
    await sleep(200);
    await getBrowser().keys('Escape');
    await sleep(200);
    const stripPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-search-strip]');`,
    );
    expect(stripPresent).to.equal(false);
  });
});
```

- [ ] **Step 2: Create tests/e2e/theme.spec.ts**

EXACT contents:

```ts
import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('theme', () => {
  it('html element has theme-dark or theme-light class', async () => {
    const cls = await classicExecute<string>(
      `return document.documentElement.className;`,
    );
    expect(cls).to.match(/theme-(dark|light)/);
  });

  it('palette command "View: Use Light Theme" switches to theme-light', async () => {
    await getBrowser().execute(() => {
      (window as unknown as { __memopadTestRunCommand: (id: string) => void }).__memopadTestRunCommand('theme.light');
    });
    await sleep(200);
    const cls = await classicExecute<string>(
      `return document.documentElement.className;`,
    );
    expect(cls).to.include('theme-light');
    expect(cls).to.not.include('theme-dark');
  });

  it('palette command "View: Use Dark Theme" switches to theme-dark', async () => {
    await getBrowser().execute(() => {
      (window as unknown as { __memopadTestRunCommand: (id: string) => void }).__memopadTestRunCommand('theme.dark');
    });
    await sleep(200);
    const cls = await classicExecute<string>(
      `return document.documentElement.className;`,
    );
    expect(cls).to.include('theme-dark');
    expect(cls).to.not.include('theme-light');
  });
});
```

- [ ] **Step 3: Run the suite**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Get-Process | Where-Object { $_.ProcessName -match '^(tauri-driver|msedgedriver|app)$' } | Stop-Process -Force -ErrorAction SilentlyContinue
npm run test:e2e
Get-Process | Where-Object { $_.ProcessName -match '^(tauri-driver|msedgedriver|app)$' } | Stop-Process -Force -ErrorAction SilentlyContinue
```

Expected: 36 (existing) + 5 (find/replace) + 3 (theme) = **44 passing, 0 failing**. The `zz-close.spec.ts` test must still run LAST and pass.

If a test flakes, common causes: input event timing, palette command not registered yet (theme commands require Task 6 to have committed; find/replace commands require Task 10). Max 3 fix iterations on test files only.

- [ ] **Step 4: Commit**

```powershell
git add tests/e2e/find-replace.spec.ts tests/e2e/theme.spec.ts
git commit -m "test(e2e): find/replace + theme switching specs"
```

---

## Task 12: Build + manual smoke + results doc

**Files:**
- Create: `docs/superpowers/plans/phase-5-results.md`

- [ ] **Step 1: Run every gate**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm test
Set-Location src-tauri
cargo test
Set-Location ..
npx tsc --noEmit
Get-Process | Where-Object { $_.ProcessName -match '^(tauri-driver|msedgedriver|app)$' } | Stop-Process -Force -ErrorAction SilentlyContinue
npm run test:e2e
Get-Process | Where-Object { $_.ProcessName -match '^(tauri-driver|msedgedriver|app)$' } | Stop-Process -Force -ErrorAction SilentlyContinue
```

Expected:
- Vitest: **43 passing** (was 32; +7 theme + 4 session-debounce)
- cargo: **51 passing** (unchanged)
- tsc --noEmit: exit 0
- e2e: **44 passing** (was 36)

- [ ] **Step 2: Build release MSI**

```powershell
npm run tauri build
```

Capture MSI + app.exe sizes.

- [ ] **Step 3: Create docs/superpowers/plans/phase-5-results.md**

EXACT template (fill `__` blanks; the user fills the manual smoke checkboxes):

```markdown
# Phase 5 — Results

## Automated test gates

- Vitest: __ tests passing (was 32)
- cargo test: __ tests passing (unchanged)
- e2e (WebdriverIO): __ tests passing (was 36)
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: __ MB (Phase 4 baseline 4.07 MB)
- app.exe size: __ MB (Phase 4 baseline 10.14 MB)

## New surface

- Bundle identifier `dev.memopad.editor` (was `dev.memopad.app`)
- JetBrains Mono bundled (regular + bold woff2)
- Memopad Dark + Memopad Light CodeMirror themes
- CSS-variable-driven app chrome that follows theme
- Theme palette commands: Toggle Theme, Use Dark, Use Light, Use System
- Inline find/replace strip with regex + case-sensitive toggles, live match count
- Ctrl+F / Ctrl+H keybindings + palette entries
- 500 ms tail-debounced session.json save

## Manual smoke

- [ ] App launches into the chromeless window with line numbers, theme-appropriate background
- [ ] Switching theme via palette (Ctrl+K → "Use Light Theme") changes the app chrome AND editor colors
- [ ] Ctrl+F opens the find strip; typing a query highlights matches and shows match count
- [ ] Ctrl+H opens the replace strip; Replace all applies the change to every occurrence
- [ ] Escape closes the search strip
- [ ] X button still closes the app (no regression)
- [ ] Kill-9 acceptance still passes (no regression on Phase 4)

## Known follow-ups (Phase 6 candidates)

- Per-tab cursor position + scroll restoration
- Diff view in external-change banner
- GitHub Actions CI running the e2e suite + perf gates
- Tauri updater plugin + GitHub Releases manifest
- Code-signing certificate for the MSI
- Find-in-files (was a v2 feature; can land in Phase 6)
- File-tree sidebar (v2; Phase 6 candidate)
```

- [ ] **Step 4: Commit**

```powershell
git add docs/superpowers/plans/phase-5-results.md
git commit -m "phase 5: record results"
```

---

## Phase 5 Acceptance

Close when ALL:

1. `npm test` → 43 passing
2. `cargo test` → 51 passing
3. `npx tsc --noEmit` → exit 0
4. `npm run test:e2e` → 44 passing
5. `npm run tauri build` produces an MSI
6. Manual smoke list in `phase-5-results.md` checked off

## What is intentionally NOT in this phase

- Per-tab cursor + scroll restoration — Phase 6
- Diff view in external-change banner — Phase 6
- CI workflow / signed installer / auto-updater — Phase 6
- Find-in-files — Phase 6 (v2 feature)
- File tree, split view, large-file handling — v2 features deferred indefinitely per spec non-goals
