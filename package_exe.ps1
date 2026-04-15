# Navi AI Agent - Package Executable for Distribution
# Creates a zip file with the built navi.exe and a README.
# Run from anywhere — resolves paths relative to this script.

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")
$buildDir = Join-Path $ProjectRoot "packages\navi\dist\navi-ai-agent-windows-x64"
$binDir = Join-Path $buildDir "bin"
$zip = Join-Path $ProjectRoot "navi_exe_dist.zip"
$configFile = Join-Path $ProjectRoot "opencode.json"

Write-Host "Preparing executable distribution..."

# check if bin dir exists
if (-not (Test-Path $binDir)) {
    Write-Error "Build directory not found at $binDir. Did the build succeed?"
    exit 1
}

# Copy opencode.json to bin directory for packaging
Copy-Item $configFile -Destination (Join-Path $binDir "opencode.json") -Force

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
Set-Content -Path (Join-Path $binDir "README.txt") -Value $readmeContent

# Zip the contents of the bin directory
Write-Host "Compressing to $zip ..."
if (Test-Path $zip) { Remove-Item $zip }

# PowerShell's Compress-Archive with -Path "$binDir\*" puts files at root of zip.
Compress-Archive -Path "$binDir\*" -DestinationPath $zip

# Cleanup temporary files in build dir
Remove-Item (Join-Path $binDir "opencode.json")
Remove-Item (Join-Path $binDir "README.txt")

Write-Host "Done! Executable package created at: $zip"
