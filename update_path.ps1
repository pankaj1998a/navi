$newDir = "v:\pankaj\navi\packages\navi\dist\navi-ai-agent-windows-x64\bin"
$oldPath = [System.Environment]::GetEnvironmentVariable("PATH", "User")
if ($oldPath -notlike "*$newDir*") {
    $updatedPath = "$oldPath;$newDir"
    [System.Environment]::SetEnvironmentVariable("PATH", $updatedPath, "User")
    Write-Host "Success: Added $newDir to User PATH."
} else {
    Write-Host "Info: $newDir is already in User PATH."
}
