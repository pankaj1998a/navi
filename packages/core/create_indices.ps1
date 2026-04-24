$dirs = "flag", "project", "storage", "provider", "permission", "sync", "snapshot", "id", "installation", "auth", "plugin", "question", "command", "share", "scheduler", "shell", "tool", "lsp"
foreach ($dir in $dirs) {
    $path = "v:\pankaj\navi\packages\core\src\$dir"
    if (Test-Path $path) {
        $files = Get-ChildItem $path -Filter "*.ts" | Where-Object { $_.Name -ne "index.ts" -and $_.Name -notlike "*.test.ts" -and $_.Name -notlike "*.d.ts" }
        $content = $files | ForEach-Object { "export * from './$($_.BaseName).ts';" }
        $content | Out-File "$path\index.ts" -Encoding utf8
    }
}
