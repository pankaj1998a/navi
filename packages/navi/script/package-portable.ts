#!/usr/bin/env bun
/**
 * package-portable.ts
 *
 * Builds Navi for Windows x64, refreshes the navi-portable/ folder with the
 * latest binary + worker files, and creates navi-portable.zip ready for
 * transfer to another PC.
 *
 * Usage:
 *   bun run script/package-portable.ts
 *   bun run script/package-portable.ts --skip-build   (if already built)
 */

import path from "path"
import fs from "fs"
import { $ } from "bun"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")          // packages/navi/
const repoRoot = path.resolve(root, "../../..")        // v:/pankaj/ — easy to find!
const distDir = path.join(root, "dist", "navi-ai-agent-windows-x64", "bin")
const portableDir = path.join(repoRoot, "navi-portable")
const zipOut = path.join(repoRoot, "navi-portable.zip")

const skipBuild = process.argv.includes("--skip-build")

// ─── Step 1: Build ────────────────────────────────────────────────────────────
if (!skipBuild) {
  console.log("🔨 Building Navi for Windows x64…")
  await $`bun run script/build.ts`.cwd(root)
  console.log("✅ Build complete")
} else {
  console.log("⏩ Skipping build (--skip-build)")
}

const exeSrc = path.join(distDir, "navi.exe")
if (!fs.existsSync(exeSrc)) {
  console.error(`❌ Expected binary not found: ${exeSrc}`)
  console.error("   Run without --skip-build or check the build output in dist/")
  process.exit(1)
}

// ─── Step 2: Refresh navi-portable/ ──────────────────────────────────────────
console.log("📦 Refreshing navi-portable/…")
fs.mkdirSync(portableDir, { recursive: true })

// Copy navi.exe
const exeDest = path.join(portableDir, "navi.exe")
fs.copyFileSync(exeSrc, exeDest)
console.log(`  ✓ navi.exe  (${(fs.statSync(exeDest).size / 1_048_576).toFixed(1)} MB)`)

// Copy cli/ worker tree recursively
const cliSrc = path.join(distDir, "cli")
const cliDest = path.join(portableDir, "cli")
copyDirSync(cliSrc, cliDest)
console.log("  ✓ cli/  (TUI workers)")

// ─── Step 3: Write install.bat ────────────────────────────────────────────────
const installBat = `@echo off
setlocal

set "TARGET_DIR=%LOCALAPPDATA%\\navi\\bin"

echo.
echo  ==========================================
echo   Navi Portable Installer
echo  ==========================================
echo.
echo  Installing Navi to:
echo    %TARGET_DIR%
echo.

if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

:: Copy main binary
copy /Y "navi.exe" "%TARGET_DIR%\\" >nul
echo  [OK] navi.exe copied

:: Copy TUI worker files
if exist "cli" (
  xcopy /E /I /Y "cli" "%TARGET_DIR%\\cli\\" >nul
  echo  [OK] cli/ workers copied
)

:: Add to User PATH (idempotent, no duplicates)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = [System.Environment]::GetEnvironmentVariable('PATH','User');" ^
  "$t = '%TARGET_DIR%';" ^
  "if ($p -notlike ('*'+$t+'*')) {" ^
    "[System.Environment]::SetEnvironmentVariable('PATH',$p+';'+$t,'User');" ^
    "Write-Host '  [OK] Added to User PATH'" ^
  "} else {" ^
    "Write-Host '  [OK] Already in PATH'" ^
  "}"

echo.
echo  ==========================================
echo   Installation complete!
echo  ==========================================
echo.
echo  Open a NEW terminal and type:
echo    navi --version
echo.
echo  To uninstall:
echo    Delete %%LOCALAPPDATA%%\\navi
echo    Remove the entry from User PATH
echo.
pause
endlocal
`
fs.writeFileSync(path.join(portableDir, "install.bat"), installBat)
console.log("  ✓ install.bat updated")

// ─── Step 4: Write uninstall.bat ─────────────────────────────────────────────
const uninstallBat = `@echo off
setlocal

set "TARGET_DIR=%LOCALAPPDATA%\\navi"

echo.
echo  Uninstalling Navi from %TARGET_DIR%…
echo.

if exist "%TARGET_DIR%" (
  rd /S /Q "%TARGET_DIR%"
  echo  [OK] Files removed
) else (
  echo  [INFO] Navi folder not found at %TARGET_DIR%  — already removed?
)

:: Remove from User PATH
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = [System.Environment]::GetEnvironmentVariable('PATH','User');" ^
  "$t = '%TARGET_DIR%\\bin';" ^
  "$new = ($p -split ';' | Where-Object { $_ -ne $t }) -join ';';" ^
  "[System.Environment]::SetEnvironmentVariable('PATH',$new,'User');" ^
  "Write-Host '  [OK] Removed from User PATH'"

echo.
echo  Uninstall complete. Restart your terminal.
echo.
pause
endlocal
`
fs.writeFileSync(path.join(portableDir, "uninstall.bat"), uninstallBat)
console.log("  ✓ uninstall.bat added")

// ─── Step 5: Write README.txt ─────────────────────────────────────────────────
const now = new Date()
const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })

const readme = `==========================================================
  Navi — Portable Edition  (built ${dateStr})
==========================================================

CONTENTS
--------
  navi.exe        Main executable (~150 MB, self-contained)
  cli/            TUI worker scripts (required — keep next to navi.exe)
  install.bat     One-click installer for Windows (no admin needed)
  uninstall.bat   Removes Navi from this PC
  README.txt      This file

QUICK START (Recommended)
--------------------------
  1. Double-click  install.bat
  2. Open a NEW terminal (PowerShell / CMD / Windows Terminal)
  3. Type:  navi

MANUAL INSTALL
--------------
  1. Copy  navi.exe  AND the  cli/  folder  to the SAME directory,
     e.g.  C:\\Users\\YourUser\\bin\\navi\\
  2. Add that directory to your User PATH.
  3. Open a new terminal and type:  navi

REQUIREMENTS
------------
  - Windows 10 / 11 — x64
  - No runtime install needed (Bun is bundled inside navi.exe)
  - For web search / web scraping features:
      Install Google Chrome or Chromium
      (https://www.google.com/chrome/)
      Navi will use your browser directly — no API key needed.

FEATURES
--------
  - Multi-agent AI coding assistant
  - VibeMode: Avni orchestrator with 12-phase workflow
  - Web Search (direct via Chrome — no API key)
  - Web Fetch (auto browser fallback for JS-heavy pages)
  - Web Crawl (recursive site crawler)
  - Web Scrape (structured data extraction)
  - Swarm / Parallel agent execution
  - And much more...

CONFIG
------
  On first run Navi will create  %APPDATA%\\navi\\  for its config,
  sessions, and cache.  This is separate from the install folder.

UNINSTALL
---------
  Double-click  uninstall.bat
  OR manually:
    1. Delete  %LOCALAPPDATA%\\navi
    2. Remove that path from User PATH

==========================================================
`
fs.writeFileSync(path.join(portableDir, "README.txt"), readme)
console.log("  ✓ README.txt updated")

// ─── Step 6: Zip ──────────────────────────────────────────────────────────────
console.log(`\n🗜  Zipping  ➜  navi-portable.zip …`)

// Remove old zip if exists
if (fs.existsSync(zipOut)) fs.unlinkSync(zipOut)

// Use pwsh (PowerShell Core) for zipping — falls back to JS-based zip
try {
  await $`pwsh -NoProfile -Command "Compress-Archive -Force -Path '${portableDir}' -DestinationPath '${zipOut}'"`.cwd(root)
} catch {
  // Fallback: build zip manually using Bun's built-in APIs
  console.log("  (pwsh not available, building zip manually…)")
  await buildZipManually(portableDir, zipOut)
}

if (fs.existsSync(zipOut)) {
  const zipSize = (fs.statSync(zipOut).size / 1_048_576).toFixed(1)
  console.log(`✅ navi-portable.zip created  (${zipSize} MB)`)
  console.log(`   Path: ${zipOut}`)
} else {
  console.log(`✅ navi-portable/ folder is ready (zip creation skipped — copy folder manually)`)
  console.log(`   Path: ${portableDir}`)
}
console.log(`\n📋 To install on another PC:`)
console.log("   1. Copy navi-portable.zip (or navi-portable/ folder) to the target PC")
console.log("   2. Extract the zip if needed")
console.log("   3. Run install.bat")

// ─── Helpers ─────────────────────────────────────────────────────────────────
function copyDirSync(src: string, dest: string) {
  if (!fs.existsSync(src)) return
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(s, d)
    } else {
      fs.copyFileSync(s, d)
    }
  }
}

/** Fallback zip using Windows 10+ built-in tar.exe (supports .zip with -a flag) */
async function buildZipManually(sourceDir: string, destZip: string) {
  const parent = path.dirname(sourceDir)
  const folderName = path.basename(sourceDir)
  try {
    await $`tar.exe -a -c -f "${destZip}" -C "${parent}" "${folderName}"`
  } catch {
    console.warn("  ⚠ Could not create zip. The navi-portable/ folder is ready — copy it manually.")
  }
}
