$profilePath = "C:\Users\X380 Yoga\OneDrive\Documents\PowerShell\Microsoft.PowerShell_profile.ps1"
$launcherPath = "C:\Users\X380 Yoga\navi-launcher.ps1"
$aliasContent = @"

# Navi
function navi { & "$launcherPath" `$args }
"@

if (-not (Test-Path $profilePath)) {
    $dir = Split-Path -Parent $profilePath
    if (-not (Test-Path $dir)) {
        New-Item -Path $dir -ItemType Directory -Force | Out-Null
    }
    New-Item -Path $profilePath -ItemType File -Force | Out-Null
}

Add-Content -Path $profilePath -Value $aliasContent
Write-Host "Navi added to profile."
