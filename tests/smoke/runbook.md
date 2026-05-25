# Memopad Phase 2 — Smoke Test Runbook

Every step is an **Action** you perform in the app, followed by a **Verify** command you paste into PowerShell. The Verify command prints `PASS` or `FAIL` based on the actual on-disk state — not on what the UI looks like.

Visual checks are noted explicitly and kept to a minimum (theme, dirty dot, syntax colors). Everything else is byte-level.

## 0. Setup

Run once at the start of the test pass. Copies fixtures into a working directory so the originals stay clean and re-runs are reproducible.

```powershell
$ws = "$env:TEMP\memopad-smoke"
Remove-Item -Recurse -Force $ws -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $ws | Out-Null
Copy-Item -Recurse -Path 'E:\Github\memopad\tests\smoke\fixtures' -Destination $ws
Get-ChildItem "$ws\fixtures" | Select-Object Name, Length
```

Expected: 8 items listed (sample.{rs,js,json,md}, utf8-lf.txt, utf8-crlf.txt, utf16le-bom.txt, .gitattributes). Fixtures path: `%TEMP%\memopad-smoke\fixtures\`.

Then launch the app from the Start menu (assuming you installed the MSI from `src-tauri/target/release/bundle/msi/Memopad_0.1.0_x64_en-US.msi`).

Working dir for the rest of this runbook: `$env:TEMP\memopad-smoke\fixtures`.

## 1. Empty-state visual

**Action:** observe the freshly launched window.

**Verify (visual only):**

- Title bar shows `Untitled` centered, no amber dot.
- Editor area below is empty, dark theme, line number `1` visible in the gutter.
- Cursor is in the editor (caret blinking).

Mark this step PASS if all three are true. FAIL otherwise.

## 2. Dirty indicator on type

**Action:** click into the editor and type `abc`.

**Verify (visual only):**

- An amber `●` dot appears next to `Untitled` in the title bar.

## 3. Reset back to empty

**Action:** press `Ctrl+N`.

**Verify (visual only):**

- Title returns to `Untitled` with no dot.
- Editor area empty again.

## 4. Open UTF-8 LF file, save without edit, bytes unchanged

**Action:** `Ctrl+O`, navigate to `%TEMP%\memopad-smoke\fixtures`, open `utf8-lf.txt`.

**Verify (visual):** title shows `utf8-lf.txt`, no dirty dot, editor shows two lines: `hello` and `world`.

**Action:** `Ctrl+S` (no edits).

**Verify:**

```powershell
$exp = '0f723ae7f9bf07744445e93ac5595156'  # md5 of "hello\nworld\n"
$got = (Get-FileHash "$env:TEMP\memopad-smoke\fixtures\utf8-lf.txt" -Algorithm MD5).Hash.ToLower()
if ($got -eq $exp) { 'PASS' } else { "FAIL got=$got expected=$exp" }
```

## 5. Edit UTF-8 LF file, save, byte diff matches

**Action:** with `utf8-lf.txt` still open, place cursor at end of last line and type `\ngoodbye` (literally type Enter then `goodbye`, no trailing newline).

**Action:** `Ctrl+S`.

**Verify (bytes):**

```powershell
$bytes = [System.IO.File]::ReadAllBytes("$env:TEMP\memopad-smoke\fixtures\utf8-lf.txt")
$expected = [System.Text.Encoding]::UTF8.GetBytes("hello`nworld`ngoodbye")
if ([System.Linq.Enumerable]::SequenceEqual($bytes, $expected)) { 'PASS' } else { "FAIL: bytes=$($bytes -join ',')" }
```

The key assertion: the save preserved LF (no CRLF mangling) and no BOM was prepended.

## 6. Edit UTF-8 CRLF file, save, CRLF preserved

**Action:** `Ctrl+O` → open `utf8-crlf.txt`.

**Verify (visual):** title shows `utf8-crlf.txt`, no dirty dot.

**Action:** place cursor at end of last line, press Enter, type `done`. `Ctrl+S`.

**Verify (bytes — every line should still end in CRLF):**

```powershell
$bytes = [System.IO.File]::ReadAllBytes("$env:TEMP\memopad-smoke\fixtures\utf8-crlf.txt")
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
$crlfCount = ([regex]::Matches($text, "`r`n")).Count
$bareLf = ([regex]::Matches($text, "(?<!`r)`n")).Count
if ($crlfCount -ge 2 -and $bareLf -eq 0) { "PASS (CRLF=$crlfCount bareLF=0)" } else { "FAIL CRLF=$crlfCount bareLF=$bareLf" }
```

CRLF count should be at least 2 (original line endings), bare LF count should be 0 — proves no CRLF→LF normalization happened.

## 7. UTF-16 LE BOM round-trip (spec acceptance #3)

This reproduces the cargo `roundtrip_tests` scenario through the UI.

**Action:** `Ctrl+O` → open `utf16le-bom.txt`.

**Verify (visual):** title shows `utf16le-bom.txt`, no dirty dot, editor shows `hi` on the first line (cursor on second blank line).

**Action:** type `world` at the end (after `hi`), then `Ctrl+S`.

**Verify (BOM + encoding round-trip):**

```powershell
$path = "$env:TEMP\memopad-smoke\fixtures\utf16le-bom.txt"
$bytes = [System.IO.File]::ReadAllBytes($path)

# Check 1: file still starts with UTF-16 LE BOM (FF FE)
$bomOk = ($bytes.Length -ge 2) -and ($bytes[0] -eq 0xFF) -and ($bytes[1] -eq 0xFE)

# Check 2: decoded content contains both the original "hi" and the new "world"
$decoded = [System.Text.Encoding]::Unicode.GetString($bytes, 2, $bytes.Length - 2)
$contentOk = $decoded.Contains('hi') -and $decoded.Contains('world')

# Check 3: no UTF-8 BOM accidentally substituted
$noUtf8Bom = -not (($bytes[0] -eq 0xEF) -and ($bytes[1] -eq 0xBB))

if ($bomOk -and $contentOk -and $noUtf8Bom) {
  "PASS — BOM preserved, content=$($decoded -replace [char]10,'\n')"
} else {
  "FAIL bomOk=$bomOk contentOk=$contentOk noUtf8Bom=$noUtf8Bom"
}
```

This is the headline acceptance scenario from `docs/superpowers/specs/2026-05-25-memopad-design.md` §5.1 #3.

## 8. Save-As to a new path

**Action:** `Ctrl+N` (reset to Untitled). Type `save-as test\n`. Then `Ctrl+Shift+S` → in the dialog, navigate to `%TEMP%\memopad-smoke\fixtures\` and save as `saved-as.txt`.

**Verify (visual):** title bar updates from `Untitled` to `saved-as.txt`. No dirty dot.

**Verify (file exists with content):**

```powershell
$p = "$env:TEMP\memopad-smoke\fixtures\saved-as.txt"
if ((Test-Path $p) -and ((Get-Content $p -Raw) -match 'save-as test')) { 'PASS' } else { 'FAIL' }
```

## 9. Save-As does NOT touch the original path

After step 8, a second `Ctrl+S` should write to `saved-as.txt`, not to `utf16le-bom.txt`.

**Action:** with `saved-as.txt` open, append `more\n`. `Ctrl+S` (not Shift+S).

**Verify:**

```powershell
$saved = "$env:TEMP\memopad-smoke\fixtures\saved-as.txt"
$utf16 = "$env:TEMP\memopad-smoke\fixtures\utf16le-bom.txt"
$savedOk = (Get-Content $saved -Raw) -match 'more'
# utf16le-bom.txt must still have the BOM from step 7 — it must NOT have been overwritten.
$bytes = [System.IO.File]::ReadAllBytes($utf16)
$bomStillThere = ($bytes[0] -eq 0xFF) -and ($bytes[1] -eq 0xFE)
if ($savedOk -and $bomStillThere) { 'PASS' } else { "FAIL savedOk=$savedOk bomStillThere=$bomStillThere" }
```

## 10. Syntax highlighting differs across four languages

**Action:** sequentially `Ctrl+O` each of `sample.rs`, `sample.js`, `sample.json`, `sample.md` from the fixtures directory.

**Verify (visual):** keywords/strings should look visibly different across each file (not all plain white):

- `sample.rs`: `fn`, `let`, `if`, `println!` highlighted in distinct colors; the string `"hello, world"` colored as a string.
- `sample.js`: `const`, `function`, `return` highlighted; the single-quoted strings colored.
- `sample.json`: keys (`"name"`, `"version"`) in one color, string values in another, `true` in a third.
- `sample.md`: `# Sample` shown as a heading (bold/larger), `**bold**` and `*italic*` shown distinctly.

Mark PASS if all four look syntactically distinct. FAIL if any look like plain text.

## 11. Missing-file error doesn't crash

**Action:** in the address bar of the open dialog (Ctrl+O), type a deliberately invalid path like `Z:\nope\does-not-exist.txt` and press Enter.

**Verify (visual):** the OS dialog rejects the path (typical Windows "File not found" prompt within the dialog) OR the dialog stays open. The app does not crash. Nothing else changes — buffer state is preserved.

(Currently we do not surface a user-visible error toast on IPC failure — that's deferred to Phase 5. The minimum bar here is "no crash.")

## Reporting

After all 11 steps, paste your pass/fail list back. I'll fill in the `phase-2-results.md` smoke section with your verdict and merge to main if everything looks clean.

Two reasonable outcomes:

- **All PASS** → merge.
- **Some FAIL** → I open targeted fix tasks before merge. Paste the FAIL output verbatim (the PowerShell snippets print exactly what diverged).
