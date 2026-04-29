#!/usr/bin/env bun
/**
 * package-portable.ts
 *
 * Builds Navi for Windows x64.
 */

import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { $ } from "bun"
import { build as buildNavi } from "./build"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root       = path.resolve(__dirname, "..")      // packages/navi/
const repoRoot   = path.resolve(root, "../../..")     // v:/pankaj/
const distDir    = path.join(root, "dist", "navi-ai-agent-windows-x64", "bin")
const portableDir = path.join(repoRoot, "navi-portable")
const zipOut     = path.join(repoRoot, "navi-portable.zip")

const skipBuild = process.argv.includes("--skip-build")

if (!skipBuild) {
  console.log("🔨 Building Navi...")
  await buildNavi({ singleFlag: true, baselineFlag: false })
}

const exeSrc = path.join(distDir, "navi.exe")
if (!fs.existsSync(exeSrc)) {
  console.error(`❌ Expected binary not found: ${exeSrc}`)
  process.exit(1)
}

console.log("📦 Refreshing navi-portable/…")
fs.rmSync(portableDir, { recursive: true, force: true })
fs.mkdirSync(portableDir, { recursive: true })

const exeDest = path.join(portableDir, "navi.exe")
fs.copyFileSync(exeSrc, exeDest)

// ─── Step 3: Write install.bat ────────────────────────────────────────────────
const installLines = [
  "@echo off",
  "setlocal",
  'set "BIN_DIR=%LOCALAPPDATA%\\navi\\bin"',
  "echo.",
  "echo  Installing Navi to: %BIN_DIR%",
  'if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"',
  'taskkill /F /IM navi.exe >nul 2>&1',
  'copy /Y "navi.exe" "%BIN_DIR%\\" >nul',
  'if errorlevel 1 (',
  '  echo  [ERROR] Failed to overwrite navi.exe. Close any running Navi terminals and try again.',
  '  pause',
  '  exit /b 1',
  ')',
  'set "LAUNCHER_PS1=%BIN_DIR%\\navi-launcher.ps1"',
  '(echo ^& "%BIN_DIR%\\navi.exe" $args) > "%LAUNCHER_PS1%"',
  "",
  'set "SETUP_PS1=%TEMP%\\navi-setup-%RANDOM%.ps1"',
  "echo $binDir = Join-Path $env:LOCALAPPDATA 'navi\\bin' >> \"%SETUP_PS1%\"",
  "echo $launcher = Join-Path $binDir 'navi-launcher.ps1' >> \"%SETUP_PS1%\"",
  "echo $path = [System.Environment]::GetEnvironmentVariable('PATH','User') >> \"%SETUP_PS1%\"",
  "echo if ($path -notlike \"*$binDir*\") { >> \"%SETUP_PS1%\"",
  "echo     [System.Environment]::SetEnvironmentVariable('PATH', $path + ';' + $binDir, 'User') >> \"%SETUP_PS1%\"",
  "echo } >> \"%SETUP_PS1%\"",
  "echo $profileDir = Split-Path $PROFILE -Parent >> \"%SETUP_PS1%\"",
  "echo if (-not (Test-Path $profileDir)) { New-Item $profileDir -ItemType Directory -Force ^| Out-Null } >> \"%SETUP_PS1%\"",
  "echo if (-not (Test-Path $PROFILE))    { New-Item $PROFILE    -ItemType File      -Force ^| Out-Null } >> \"%SETUP_PS1%\"",
  "echo $content = Get-Content $PROFILE -Raw -ErrorAction SilentlyContinue >> \"%SETUP_PS1%\"",
  "echo $newFunc = \"function navi { & '$launcher' `$args }\" >> \"%SETUP_PS1%\"",
  "echo if ($content -match 'function navi') { >> \"%SETUP_PS1%\"",
  "echo     $content -replace 'function navi\\s*\\{[^\\}]*\\}', $newFunc ^| Set-Content $PROFILE >> \"%SETUP_PS1%\"",
  "echo     Write-Host '  [OK] Updated existing navi function in profile' >> \"%SETUP_PS1%\"",
  "echo } else { >> \"%SETUP_PS1%\"",
  "echo     Add-Content $PROFILE \"`n# Navi AI Agent`n$newFunc\" >> \"%SETUP_PS1%\"",
  "echo     Write-Host '  [OK] Added navi function to profile' >> \"%SETUP_PS1%\"",
  "echo } >> \"%SETUP_PS1%\"",
  'powershell -NoProfile -ExecutionPolicy Bypass -File "%SETUP_PS1%"',
  'del "%SETUP_PS1%" >nul 2>&1',
  "echo. Installation complete! Restart PowerShell. & pause & endlocal",
]
fs.writeFileSync(path.join(portableDir, "install.bat"), installLines.join("\r\n"))

// ─── Step 4: Write uninstall.bat ─────────────────────────────────────────────
const uninstallLines = [
  "@echo off",
  "setlocal",
  'set "NAVI_DIR=%LOCALAPPDATA%\\navi"',
  'if exist "%NAVI_DIR%" rd /S /Q "%NAVI_DIR%"',
  'set "CLEANUP_PS1=%TEMP%\\navi-cleanup-%RANDOM%.ps1"',
  "echo $binDir = Join-Path $env:LOCALAPPDATA 'navi\\bin' >> \"%CLEANUP_PS1%\"",
  "echo $path = [System.Environment]::GetEnvironmentVariable('PATH','User') >> \"%CLEANUP_PS1%\"",
  "echo $newPath = ($path -split ';' ^| Where-Object { $_ -ne $binDir }) -join ';' >> \"%CLEANUP_PS1%\"",
  "echo [System.Environment]::SetEnvironmentVariable('PATH', $newPath, 'User') >> \"%CLEANUP_PS1%\"",
  "echo if (Test-Path $PROFILE) { >> \"%CLEANUP_PS1%\"",
  "echo     (Get-Content $PROFILE) ^| Where-Object { $_ -notmatch 'function navi' -and $_ -notmatch '# Navi AI Agent' } ^| Set-Content $PROFILE >> \"%CLEANUP_PS1%\"",
  "echo } >> \"%CLEANUP_PS1%\"",
  'powershell -NoProfile -ExecutionPolicy Bypass -File "%CLEANUP_PS1%"',
  'del "%CLEANUP_PS1%" >nul 2>&1',
  "echo. Uninstall complete. & pause & endlocal",
]
fs.writeFileSync(path.join(portableDir, "uninstall.bat"), uninstallLines.join("\r\n"))

// ─── Step 5: README ────────────────────────────────────────────────────────
fs.writeFileSync(path.join(portableDir, "README.txt"), "Run install.bat to setup Navi.")

// ─── Step 6: Zip ──────────────────────────────────────────────────────────
if (fs.existsSync(zipOut)) fs.unlinkSync(zipOut)
await $`pwsh -NoProfile -Command "Compress-Archive -Force -Path '${portableDir}' -DestinationPath '${zipOut}'"`.cwd(root).catch(() => {})
console.log("✅ navi-portable.zip updated")
