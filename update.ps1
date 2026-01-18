# Navi AI Agent - Windows Updater
# This script updates Navi to the latest version from GitHub.

$ErrorActionPreference = "Stop"

Write-Host "`n╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                     Navi AI Agent - Updater                      ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

# 1. Pull latest code
Write-Host "📥 Pulling latest changes from GitHub..." -ForegroundColor Cyan
git pull

# 2. Update dependencies
Write-Host "📦 Updating dependencies..." -ForegroundColor Cyan
bun install

# 3. Refresh shims
Write-Host "🛠️  Refreshing installation..." -ForegroundColor Cyan
.\install.ps1

Write-Host "`n✨ Navi has been updated to the latest version!" -ForegroundColor Green
Write-Host "🚀 Run 'navi' to start.`n" -ForegroundColor Green
