# Memopad Phase 1 — Walking Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Tauri 2 + React + TypeScript + Vite project that builds a Windows MSI installer and opens a chromeless window with a working custom title bar (close, minimize, maximize/restore, drag region). No editor, no file I/O — just the shell the rest of Memopad will live inside.

**Architecture:** Tauri 2 host process (Rust) owns the OS window with native decorations disabled. A React + TS UI renders inside WebView2, including a custom `TitleBar` component that calls Tauri window-control APIs over IPC. Vite is the dev/build tool for the UI side; `cargo` builds the Rust side; the `tauri-cli` orchestrates both.

**Tech Stack:** Tauri 2 (latest stable), Rust (stable toolchain via rustup), Node 20+, npm, React 18, TypeScript 5, Vite 5, Tailwind CSS 3.

**Spec section reference:** `docs/superpowers/specs/2026-05-25-memopad-design.md` sections 2 (tech stack), 4.1 (chromeless layout), 4.4 (visual defaults — only typography prep here).

---

## File Structure Created in This Phase

```
memopad/
├── .gitignore                 (extended; already exists)
├── package.json               npm scripts + UI deps
├── package-lock.json
├── tsconfig.json              UI compile config
├── tsconfig.node.json         Vite config compile target
├── vite.config.ts             Vite + Tauri dev-server hookup
├── tailwind.config.js
├── postcss.config.js
├── index.html                 Vite entry
├── src/
│   ├── main.tsx               React root mount
│   ├── App.tsx                Root component (TitleBar + empty editor area)
│   ├── index.css              Tailwind directives + base layout
│   └── components/
│       └── TitleBar.tsx       Custom title bar (drag region + window controls)
└── src-tauri/
    ├── Cargo.toml             Rust deps (tauri, serde, etc.)
    ├── build.rs               Tauri build helper
    ├── tauri.conf.json        Window config, bundle config, identifier
    ├── icons/                 App icons (placeholder set, replaced later)
    │   ├── 32x32.png
    │   ├── 128x128.png
    │   ├── 128x128@2x.png
    │   ├── icon.ico
    │   └── icon.icns
    └── src/
        ├── main.rs            Tauri entry point (calls into lib)
        └── lib.rs             Builder + command registration
```

Files are split by responsibility: `TitleBar.tsx` owns nothing but chrome interaction; `App.tsx` is the layout shell; Rust `lib.rs` owns Tauri setup so `main.rs` stays trivial. The editor module is intentionally absent — Phase 2 introduces it.

---

## Task 1: Verify prerequisites

**Files:** none (environment check only)

- [ ] **Step 1: Verify Node and npm**

Run:
```powershell
node --version
npm --version
```
Expected: Node ≥ 20.x, npm ≥ 10.x. If missing, install Node LTS from nodejs.org and re-open the shell.

- [ ] **Step 2: Verify Rust toolchain**

Run:
```powershell
rustc --version
cargo --version
```
Expected: rustc ≥ 1.75 (stable). If missing, install via `winget install Rustlang.Rustup` then `rustup default stable`.

- [ ] **Step 3: Verify Microsoft C++ Build Tools (required by Rust on Windows)**

Run:
```powershell
where link.exe
```
Expected: a path under `Microsoft Visual Studio\...\VC\Tools\MSVC\...`. If "INFO: Could not find files", install "Build Tools for Visual Studio 2022" with the "Desktop development with C++" workload from https://visualstudio.microsoft.com/downloads/.

- [ ] **Step 4: Verify WebView2 runtime**

Run:
```powershell
Get-ItemProperty -Path "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue | Select-Object pv
```
Expected: a `pv` value like `120.x.x.x`. If empty, install the WebView2 Evergreen Bootstrapper from https://developer.microsoft.com/microsoft-edge/webview2/. (Windows 11 normally ships it.)

- [ ] **Step 5: No commit (environment only)**

---

## Task 2: Initialize npm project and install UI deps

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`

- [ ] **Step 1: Initialize npm project**

Run:
```powershell
npm init -y
```

- [ ] **Step 2: Install React + Vite + TypeScript + Tailwind**

Run:
```powershell
npm install react@^18.3.0 react-dom@^18.3.0
npm install --save-dev typescript@^5.5.0 @types/react@^18.3.0 @types/react-dom@^18.3.0 vite@^5.4.0 @vitejs/plugin-react@^4.3.0 tailwindcss@^3.4.0 postcss@^8.4.0 autoprefixer@^10.4.0
```

- [ ] **Step 3: Replace package.json contents**

Overwrite `package.json` with:
```json
{
  "name": "memopad",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "tauri": "tauri"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
```

Run `npm install` once more to lock the file.

- [ ] **Step 4: Create tsconfig.json**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 5: Create tsconfig.node.json**

Create `tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json tsconfig.json tsconfig.node.json
git commit -m "scaffold: npm project with React+TS+Vite deps"
```

---

## Task 3: Add Tailwind and Vite config

**Files:**
- Create: `tailwind.config.js`
- Create: `postcss.config.js`
- Create: `vite.config.ts`

- [ ] **Step 1: Create tailwind.config.js**

Create `tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 2: Create postcss.config.js**

Create `postcss.config.js`:
```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Create vite.config.ts**

Create `vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri spawns Vite on a fixed port and intercepts requests; do not let Vite
// auto-pick a different port.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
  },
});
```

- [ ] **Step 4: Commit**

```powershell
git add tailwind.config.js postcss.config.js vite.config.ts
git commit -m "scaffold: Tailwind + Vite config"
```

---

## Task 4: Build a Vite-only "hello world" and verify it runs

**Files:**
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/index.css`

- [ ] **Step 1: Create index.html**

Create `index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Memopad</title>
  </head>
  <body class="bg-neutral-900 text-neutral-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create src/index.css**

Create `src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root {
  height: 100%;
  margin: 0;
  overflow: hidden;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 3: Create src/main.tsx**

Create `src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 4: Create src/App.tsx (placeholder shell)**

Create `src/App.tsx`:
```tsx
export default function App() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-neutral-400">
      Memopad — Phase 1 skeleton
    </div>
  );
}
```

- [ ] **Step 5: Run Vite dev and verify**

Run:
```powershell
npm run dev
```
Expected: Vite prints `Local: http://localhost:1420/`. Open that URL in any browser. The page should show "Memopad — Phase 1 skeleton" centered on a dark background. Press `Ctrl+C` to stop.

If the page is blank, open the browser DevTools console — the most common issue is a typo in import paths (`./App` vs `./app`).

- [ ] **Step 6: Commit**

```powershell
git add index.html src/
git commit -m "scaffold: React hello-world renders via Vite"
```

---

## Task 5: Install Tauri CLI and initialize the Rust side

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/icons/*` (Tauri provides placeholder set)
- Modify: `package.json` (add `@tauri-apps/api` and `@tauri-apps/cli`)
- Modify: `.gitignore` (ignore `src-tauri/target/`)

- [ ] **Step 1: Install Tauri CLI and JS API**

Run:
```powershell
npm install --save-dev @tauri-apps/cli@^2.0.0
npm install @tauri-apps/api@^2.0.0
```

- [ ] **Step 2: Initialize the Tauri project (non-interactive)**

Run:
```powershell
npm run tauri init -- --ci --app-name "Memopad" --window-title "Memopad" --frontend-dist "../dist" --dev-url "http://localhost:1420"
```
Expected: a `src-tauri/` directory is created with `Cargo.toml`, `tauri.conf.json`, `build.rs`, `src/main.rs`, `src/lib.rs`, and `icons/`. The CLI does not modify `package.json` scripts; the `"tauri": "tauri"` script you added earlier remains in place.

If the command fails with "tauri init: unknown option `--ci`", upgrade `@tauri-apps/cli` (`npm install --save-dev @tauri-apps/cli@latest`) and rerun.

- [ ] **Step 3: Inspect src-tauri/Cargo.toml**

Open `src-tauri/Cargo.toml`. Confirm `tauri = { version = "2", ... }` and `tauri-build = { version = "2", ... }`. No edits needed in this task.

- [ ] **Step 4: Replace tauri.conf.json with Memopad config**

Overwrite `src-tauri/tauri.conf.json`:
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Memopad",
  "version": "0.1.0",
  "identifier": "dev.memopad.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Memopad",
        "label": "main",
        "width": 1100,
        "height": 720,
        "minWidth": 480,
        "minHeight": 320,
        "decorations": false,
        "resizable": true,
        "transparent": false,
        "visible": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "nsis"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

Notes for the reader:
- `decorations: false` removes the OS title bar; we will draw our own (Task 7).
- `csp: null` is acceptable for dev. We tighten CSP in Phase 5.
- `identifier` must be a reverse-DNS string and must not change once installed users exist; pick the final string now.

- [ ] **Step 5: Extend .gitignore**

Append to `.gitignore`:
```
node_modules/
dist/
src-tauri/target/
src-tauri/gen/
*.log
```

- [ ] **Step 6: Verify Rust side compiles via tauri dev**

Run:
```powershell
npm run tauri dev
```
Expected:
1. Vite starts on port 1420.
2. Cargo downloads and compiles `tauri` and dependencies (slow on first run — 3-8 minutes is normal).
3. A frameless window opens showing "Memopad — Phase 1 skeleton".

If a Windows Defender / SmartScreen prompt appears for `cargo` or the dev exe, allow it.

Press `Ctrl+C` in the terminal to stop. Closing the window also stops the dev session.

If compilation fails with a linker error mentioning `link.exe`, return to Task 1 Step 3 — the C++ Build Tools are missing.

- [ ] **Step 7: Commit**

```powershell
git add src-tauri/ .gitignore package.json package-lock.json
git commit -m "scaffold: Tauri 2 wired to Vite, chromeless window opens"
```

---

## Task 6: Add IPC commands for window control

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml` (no changes expected; verify only)

- [ ] **Step 1: Read current src-tauri/src/lib.rs**

Open `src-tauri/src/lib.rs`. The init produces something like:
```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
```

- [ ] **Step 2: Replace src-tauri/src/lib.rs with window-control commands**

Overwrite `src-tauri/src/lib.rs`:
```rust
#[tauri::command]
fn window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_toggle_maximize(window: tauri::Window) -> Result<(), String> {
    let is_max = window.is_maximized().map_err(|e| e.to_string())?;
    if is_max {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn window_close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_is_maximized(window: tauri::Window) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_is_maximized,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Notes:
- Each command returns `Result<_, String>` because `tauri::Error` is not `Serialize`. Stringifying at the boundary is the standard Tauri 2 pattern.
- We removed the `greet` example and the `tauri_plugin_opener` plugin (not needed; we add file/dialog plugins in Phase 2).

- [ ] **Step 3: Update src-tauri/src/main.rs to call run()**

Read `src-tauri/src/main.rs`. It should already be:
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    memopad_lib::run();
}
```
If the crate name differs (the CLI may have used `memopad_lib` or `app_lib`), keep whatever the init produced — do not rename here.

- [ ] **Step 4: Verify Rust compiles**

Run:
```powershell
cd src-tauri
cargo check
cd ..
```
Expected: `Finished ... target(s) in Xs` with no errors. Warnings are fine. If you see "function `greet` is undefined", revisit Step 2 — the invoke_handler must list only the four window commands.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/lib.rs
git commit -m "shell: add window minimize/maximize/close IPC commands"
```

---

## Task 7: Build the custom TitleBar React component

**Files:**
- Create: `src/components/TitleBar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css` (add `-webkit-app-region` rules)

- [ ] **Step 1: Add drag-region CSS helpers**

Append to `src/index.css`:
```css
.drag-region {
  -webkit-app-region: drag;
  user-select: none;
}
.no-drag {
  -webkit-app-region: no-drag;
}
```

Note for the reader: `-webkit-app-region: drag` is the WebView2/Chromium directive that tells the OS "treat this DOM region as the title bar for drag purposes." Buttons inside the drag region must opt out with `no-drag`, otherwise clicks are eaten by the drag handler.

- [ ] **Step 2: Create src/components/TitleBar.tsx**

Create `src/components/TitleBar.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

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
    <div className="drag-region flex h-9 select-none items-center justify-between border-b border-neutral-800 bg-neutral-900 text-neutral-300">
      <button
        type="button"
        className="no-drag flex h-full w-9 items-center justify-center text-base hover:bg-neutral-800"
        aria-label="App menu"
      >
        ≡
      </button>

      <div className="pointer-events-none flex-1 text-center text-xs tracking-wide text-neutral-500">
        Memopad
      </div>

      <div className="no-drag flex h-full">
        <button
          type="button"
          aria-label="Minimize"
          className="flex h-full w-11 items-center justify-center hover:bg-neutral-800"
          onClick={() => invoke('window_minimize').catch(console.error)}
        >
          &#x2013;
        </button>
        <button
          type="button"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          className="flex h-full w-11 items-center justify-center hover:bg-neutral-800"
          onClick={() => invoke('window_toggle_maximize').catch(console.error)}
        >
          {maximized ? '❐' : '☐'}
        </button>
        <button
          type="button"
          aria-label="Close"
          className="flex h-full w-11 items-center justify-center hover:bg-red-600 hover:text-white"
          onClick={() => invoke('window_close').catch(console.error)}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update src/App.tsx to render TitleBar above the body**

Overwrite `src/App.tsx`:
```tsx
import { TitleBar } from './components/TitleBar';

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <main className="flex flex-1 items-center justify-center text-sm text-neutral-500">
        Memopad — Phase 1 skeleton
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run the app and smoke-test the title bar**

Run:
```powershell
npm run tauri dev
```

Verify all of the following manually:
1. The window has no native title bar; the custom dark bar appears at the top with `≡` on the left, "Memopad" centered, and three buttons (–, ☐, ×) on the right.
2. Dragging the middle of the bar moves the window.
3. Clicking `–` minimizes; clicking the taskbar icon restores.
4. Clicking the maximize button toggles between maximized and restored; the icon flips between ☐ and the restore glyph.
5. Double-clicking the drag region toggles maximize (Windows default; this comes for free with `-webkit-app-region: drag`).
6. Clicking `×` closes the window.
7. Resizing from the window edges still works (Tauri provides invisible 4 px resize borders even with `decorations: false`).

If dragging does not work, you most likely lost the `drag-region` class on the parent — check the rendered DOM in DevTools (`Ctrl+Shift+I`).

- [ ] **Step 5: Commit**

```powershell
git add src/components/TitleBar.tsx src/App.tsx src/index.css
git commit -m "ui: chromeless custom title bar with minimize/maximize/close"
```

---

## Task 8: Produce an MSI installer and smoke-test it

**Files:** none modified — verifies build outputs.

- [ ] **Step 1: Stop any running dev session**

Make sure no `npm run tauri dev` process is running, otherwise the bundle build will fail with a file-lock error on `target/`.

- [ ] **Step 2: Run the release build**

Run:
```powershell
npm run tauri build
```
Expected: the build takes 5–15 minutes the first time. The final lines should include paths like:
```
Finished 2 bundles at:
  E:\Github\memopad\src-tauri\target\release\bundle\msi\Memopad_0.1.0_x64_en-US.msi
  E:\Github\memopad\src-tauri\target\release\bundle\nsis\Memopad_0.1.0_x64-setup.exe
```

If the build fails with "wix toolset not found", Tauri will print a hint. Run the suggested `npm run tauri build` again — Tauri auto-downloads WiX on first MSI build, and the second run picks it up.

- [ ] **Step 3: Install and run the MSI**

Run:
```powershell
Start-Process -FilePath "src-tauri\target\release\bundle\msi\Memopad_0.1.0_x64_en-US.msi"
```
A Windows SmartScreen warning is expected (we are unsigned — covered in spec section 6). Click "More info" → "Run anyway" → complete the install wizard with defaults.

Then launch Memopad from the Start menu. Verify:
1. The app icon appears (default Tauri placeholder is fine in Phase 1).
2. The window opens chromeless with the custom title bar.
3. All four title-bar interactions (drag, min, max, close) work, same as in dev mode.

- [ ] **Step 4: Record installed binary size**

Run:
```powershell
Get-ChildItem "C:\Program Files\Memopad\" -Recurse | Measure-Object Length -Sum | Select-Object Sum
```
Record the sum in megabytes. Phase 1 target is a soft "under 20 MB"; on a fresh Tauri 2 + React build it is typically 8–12 MB. We track this from Phase 1 forward so regressions are obvious.

- [ ] **Step 5: Uninstall (clean state for future builds)**

Uninstall via Settings → Apps → Memopad → Uninstall. (Keeping it installed is fine if you prefer; uninstalling just keeps the dev machine tidy.)

- [ ] **Step 6: Commit nothing — record results in a brief PHASE1_NOTES.md**

Create `docs/superpowers/plans/phase-1-results.md`:
```markdown
# Phase 1 — Build Results

- MSI path: src-tauri/target/release/bundle/msi/Memopad_0.1.0_x64_en-US.msi
- NSIS path: src-tauri/target/release/bundle/nsis/Memopad_0.1.0_x64-setup.exe
- Installed size (sum of C:\Program Files\Memopad\**): __ MB
- Cold start (manual stopwatch, install → first paint): ~ __ ms
- Smoke test (drag, min, max, close): PASS / FAIL — notes:
```
Fill in the blanks, then:

```powershell
git add docs/superpowers/plans/phase-1-results.md
git commit -m "phase 1: record build size and smoke-test results"
```

---

## Phase 1 Acceptance

You can close Phase 1 once **all** of these are true:

1. `npm run dev` serves the React shell at http://localhost:1420.
2. `npm run tauri dev` opens a chromeless window with a working custom title bar.
3. `npm run tauri build` produces an MSI and an NSIS installer.
4. Installing the MSI yields a working `Memopad` app reachable from the Start menu.
5. The custom title bar supports drag, minimize, maximize/restore, and close.
6. Installed footprint is recorded; the value is documented even if it is above 20 MB at this phase (Phase 5 has the size gate).

## What is intentionally NOT in this phase

- Editor (CodeMirror) — Phase 2.
- File open/save — Phase 2.
- Tabs / buffers / status bar — Phase 3.
- Themes / fonts / final visual polish — Phase 5.
- Code signing, auto-update, CI gates — Phase 5.
- Unit tests — Phase 2 introduces the first testable units (`shell/fs`). Phase 1 verification is manual because nothing here is logic worth unit-testing; the value is in the toolchain working end-to-end.
