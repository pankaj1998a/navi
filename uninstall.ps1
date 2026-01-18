# Navi AI Agent - Windows Uninstaller
# This script removes Navi from your system.

$ErrorActionPreference = "Stop"

Write-Host "`n╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
Write-Host "║                   Navi AI Agent - Uninstaller                    ║" -ForegroundColor Yellow
Write-Host "╚══════════════════════════════════════════════════════════════════╝`n" -ForegroundColor Yellow

$currentDir = Get-Location

# 1. Remove from PATH
Write-Host "🔗 Removing Navi from your PATH..." -ForegroundColor Cyan
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -like "*$currentDir*") {
    # Remove the directory and any trailing/leading semicolons
    $newPath = $userPath -replace [regex]::Escape(";$currentDir"), ""
    $newPath = $newPath -replace [regex]::Escape("$currentDir;"), ""
    $newPath = $newPath -replace [regex]::Escape($currentDir), ""
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "✅ Removed from PATH." -ForegroundColor Green
}
else {
    Write-Host "ℹ️  Not found in PATH." -ForegroundColor Gray
}

# 2. Remove Shims in WindowsApps (if they exist)
$appsPath = "$env:LOCALAPPDATA\Microsoft\WindowsApps"
$shims = @("navi.cmd", "navi.ps1")

foreach ($shim in $shims) {
    $shimPath = Join-Path $appsPath $shim
    if (Test-Path $shimPath) {
        Remove-Item $shimPath -Force
        Write-Host "✅ Removed shim: $shim" -ForegroundColor Green
    }
}

# 3. Clean up local shims
$localShims = @("navi.cmd", "navi.ps1", "navi-launcher.sh")
foreach ($shim in $localShims) {
    if (Test-Path $shim) {
        Remove-Item $shim -Force
    }
}

Write-Host "`n✨ Navi has been uninstalled from your system." -ForegroundColor Green
Write-Host "🗑️  You can now safely delete the project folder if you wish.`n" -ForegroundColor Yellow
