# Navi AI Agent - Windows Installer
# This script installs Navi from source on your device.

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "                Navi AI Agent - Installer" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""

# 2. Install Dependencies
Write-Host "📦 Installing project dependencies..." -ForegroundColor Cyan
bun install

# 3. Create Launcher Script
Write-Host "🛠️  Setting up global command..." -ForegroundColor Cyan
$CURRENT_DIR = Get-Location
$BIN_PATH = Join-Path $env:USERPROFILE "navi-launcher.ps1"

$launcherContent = @"
& "$CURRENT_DIR\packages\navi\dist\navi-ai-agent-windows-x64\bin\navi.exe" `$args
"@

Set-Content -Path $BIN_PATH -Value $launcherContent

# 4. Add to PATH
$profilePath = $PROFILE
if (-not (Test-Path $profilePath)) {
    $profileDir = Split-Path -Parent $profilePath
    if (-not (Test-Path $profileDir)) {
        New-Item -Path $profileDir -ItemType Directory -Force | Out-Null
    }
    New-Item -Path $profilePath -ItemType File -Force | Out-Null
}

$aliasLine = "`nfunction navi { & `"$BIN_PATH`" `$args }"

if (Get-Content $profilePath | Select-String -Pattern "function navi" -Quiet) {
    Write-Host "ℹ️  Navi function already exists in PowerShell profile." -ForegroundColor Yellow
} else {
    Add-Content -Path $profilePath -Value "`n# Navi"
    Add-Content -Path $profilePath -Value $aliasLine
    Write-Host "✅ Added function to PowerShell profile" -ForegroundColor Green
}

Write-Host ""
Write-Host "✨ Navi has been successfully installed!" -ForegroundColor Green
Write-Host "🚀 You can now run 'navi' from any PowerShell window." -ForegroundColor Green
Write-Host "💡 Note: You may need to restart your PowerShell or run '. `$PROFILE' for changes to take effect." -ForegroundColor Yellow
Write-Host ""
