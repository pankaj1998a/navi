# Navi AI Agent - Windows PATH Updater
# Adds the navi bin directory to the user PATH.
# Run from the project root or anywhere — resolves paths relative to this script.

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..")
$newDir = Join-Path $ProjectRoot "packages\navi\dist\navi-ai-agent-windows-x64\bin"

$oldPath = [System.Environment]::GetEnvironmentVariable("PATH", "User")
if ($oldPath -notlike "*$newDir*") {
    $updatedPath = "$oldPath;$newDir"
    [System.Environment]::SetEnvironmentVariable("PATH", $updatedPath, "User")
    Write-Host "Success: Added $newDir to User PATH."
} else {
    Write-Host "Info: $newDir is already in User PATH."
}
