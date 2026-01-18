# Navi AI Agent - Windows Installer
# This script installs Navi from source on your Windows device.

$ErrorActionPreference = "Stop"

Write-Host "`n╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                    Navi AI Agent - Installer                     ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

# 1. Check for Bun
if (!(Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "ℹ️  Bun is not installed. Navi requires Bun to run from source." -ForegroundColor Yellow
    $installBun = Read-Host "Would you like to install Bun now? (y/n)"
    if ($installBun -eq "y") {
        Write-Host "📥 Installing Bun..." -ForegroundColor Cyan
        powershell -c "irm bun.sh/install.ps1 | iex"
        $env:PATH = "$env:USERPROFILE\.bun\bin;$env:PATH"
    }
    else {
        Write-Host "❌ Installation cancelled. Bun is required." -ForegroundColor Red
        exit 1
    }
}

# 2. Install Dependencies
Write-Host "📦 Installing project dependencies..." -ForegroundColor Cyan
bun install

# 3. Create Shims
Write-Host "🛠️  Setting up global command..." -ForegroundColor Cyan
$currentDir = Get-Location
$naviCmd = Join-Path $currentDir "navi.cmd"
$naviPs1 = Join-Path $currentDir "navi.ps1"

$cmdContent = @"
@echo off
bun run --cwd "$currentDir\packages\navi" --conditions=browser src/index.ts %*
"@

$ps1Content = @"
bun run --cwd "$currentDir\packages\navi" --conditions=browser src/index.ts `$args
"@

Set-Content -Path $naviCmd -Value $cmdContent
Set-Content -Path $naviPs1 -Value $ps1Content

# 4. Add to PATH
Write-Host "🔗 Adding Navi to your PATH..." -ForegroundColor Cyan
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$currentDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$currentDir", "User")
    $env:PATH = "$currentDir;$env:PATH"
    Write-Host "✅ Added to PATH." -ForegroundColor Green
}
else {
    Write-Host "ℹ️  Already in PATH." -ForegroundColor Gray
}

Write-Host "`n✨ Navi has been successfully installed!" -ForegroundColor Green
Write-Host "🚀 You can now run 'navi' from any terminal window." -ForegroundColor Green
Write-Host "💡 Note: You may need to restart your terminal for changes to take effect.`n" -ForegroundColor Yellow
