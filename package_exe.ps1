
$buildDir = "v:\pankaj\navi\packages\navi\dist\navi-ai-agent-windows-x64"
$binDir = "$buildDir\bin"
$zip = "v:\pankaj\navi_exe_dist.zip"
$configFile = "v:\pankaj\navi\opencode.json"

Write-Host "Preparing executable distribution..."

# check if bin dir exists
if (-not (Test-Path $binDir)) {
    Write-Error "Build directory not found at $binDir. Did the build succeed?"
    exit 1
}

# Copy opencode.json to bin directory for packaging
Copy-Item $configFile -Destination "$binDir\opencode.json" -Force

# Create README.txt
$readmeContent = @"
Navi AI Agent - Standalone Executable
=====================================

Installation:
1. Extract this zip file to a folder of your choice (e.g., C:\navi).
2. The main executable is 'navi.exe'.

Configuration:
- 'opencode.json' is included in this folder. Navi uses this for model configuration.
- If you have an API key or other secrets, ensure they are set in your environment variables or in a .env file if supported.

Usage:
Open a terminal in this folder and run:
> .\navi.exe

Or add this folder to your system PATH to run 'navi' from anywhere.
"@
Set-Content -Path "$binDir\README.txt" -Value $readmeContent

# Zip the contents of the bin directory
# We want the *contents* of bin to be at the root of the zip, or inside a folder.
# Let's simple zip the bin directory itself, so unzipping creates a folder.
Write-Host "Compressing to $zip ..."
if (Test-Path $zip) { Remove-Item $zip }

# PowerShell's Compress-Archive with -Path "$binDir\*" puts files at root of zip.
Compress-Archive -Path "$binDir\*" -DestinationPath $zip

# Cleanup temporary files in build dir
Remove-Item "$binDir\opencode.json"
Remove-Item "$binDir\README.txt"

Write-Host "Done! Executable package created at: $zip"
