# PowerShell Style Guide

> Source: The PowerShell Best Practices and Style Guide (https://github.com/PoshCode/PowerShellPracticeAndStyle) plus PSScriptAnalyzer (https://github.com/PowerShell/PSScriptAnalyzer)

## Quick Rules

- Use full command names (`Get-Process`, not `gps`/`ps`) and full parameter names (`-Name`, not positional).
- Use approved verbs: `Get-Verb` lists them. Name functions `Verb-Noun` in PascalCase.
- Indent 4 spaces. Limit lines to 115 characters.
- Use the "One True Brace Style": the opening brace goes at the end of the line, the closing brace starts a line.
- PascalCase for all public identifiers; lowercase for language keywords and operators.
- Advanced functions always start with `[CmdletBinding()]` and declare `param()`, `process {}`, `end {}` in that order.
- Never use `return` in an advanced function; emit objects from the `process {}` block instead.
- Use `Write-Error` / `throw` for failures; never test `$?` to detect errors. Run PSScriptAnalyzer in CI.

## Formatting

- Indent: 4 spaces per level. Continuation lines may be indented further to align with a method call.
- Line length: 115 characters. Prefer splatting and implied line continuation inside parentheses over the backtick.
- One True Brace Style: `function Test-Code {` and `}` on its own line. Small scriptblock arguments may stay on one line.
- Blank lines: two around function and class definitions, one between methods in a class, one at end of file.
- No trailing whitespace. One space around operators, after commas, and around `=` in parameter defaults.
- Command and parameter style: `Get-Process -Name Explorer` - full verb, full parameter, `-Parameter` prefix.
- Use explicit paths built from `$PSScriptRoot`; avoid `.\` and `..` relative paths and the `~` home shortcut.

## Naming

- Approved verbs only, from `Get-Verb`.
- Parameters: PascalCase, since they are .NET properties - `$Path`, `$LiteralPath`.
- Private variables inside a function may be camelCase to distinguish them from parameters.
- Two-letter acronyms stay fully capitalized in public names - `$PSBoundParameters`, `Get-PSDrive`.
- Script files use `Verb-Noun.ps1`; modules use `Verb-Noun.psm1` with a matching `Verb-Noun.psd1` manifest.

## Types and Data

- Declare a type for every parameter: `[string]$Path`, `[int]$Count`, `[switch]$Force`.
- Use `param()` blocks with `[Parameter()]` attributes for validation, not runtime checks in the body.
- Use `AllowNull()`, `AllowEmptyString()`, and `AllowEmptyCollection()` when a null or empty value is legitimate.
- Use `$null` for absence; never use an empty string as a null substitute.
- When a parameter set is used, always set `DefaultParameterSetName` on `[CmdletBinding()]`.

## Comments and Documentation

- Comment-based help goes *inside* the function, at the top, so it travels with the code and is easy to update.
- Use the `.SYNOPSIS`, `.DESCRIPTION`, `.PARAMETER`, `.EXAMPLE`, `.NOTES`, `.OUTPUTS`, `.LINK` keywords in UPPERCASE.
- `.SYNOPSIS` is one line; `.DESCRIPTION` explains the behavior and any caveats. `.PARAMETER` entries use the exact parameter name.
- Ordinary comments start with `# ` and are complete sentences explaining *why*, not what.
- Use `<# ... #>` for long block comments, with the delimiters on their own lines.

## Error Handling

- Use `-ErrorAction Stop` on cmdlets so failures become terminating, trappable exceptions.
- For non-cmdlets, set `$ErrorActionPreference = 'Stop'` around the call and restore it afterwards.
- Wrap risky work in `try { } catch { }` and handle the error in the catch block.
- Immediately copy `$Error[0]` (or `$_`) into your own variable inside a catch block - running any other command can overwrite it.
- Do not use `$?` to test for errors; it reports command success, not error state.
- Do not use a flag variable to signal failure; put the whole transaction inside the `try` block.
- Rethrow with context: `throw "Unable to read '$Path'. $($_.Exception.Message)"`. Use `Write-Error` for non-terminating problems.

## Testing

- Use Pester v5 syntax: `Describe`, `Context`, `It`, `BeforeAll`, `BeforeEach`, `AfterAll`, `AfterEach`.
- Name the `Describe` block after the unit and each `It` block as a behavior: `It 'returns an order for a known id' { ... }`.
- Arrange / Act / Assert, separated by blank lines. Use `Should -Be`, `Should -BeExactly`, `Should -Throw` for assertions.
- Put shared setup in `BeforeAll` and per-test setup in `BeforeEach`; keep them in the right scope so variables are visible.
- Use `InModuleScope` to test private functions of a module. Mock external commands with `Mock`.

## Anti-Patterns

- Using an alias (`ls`, `gci`, `?`). Instead: write the full command name.
- Omitting `-` before a parameter. Instead: `Get-Process -Name Explorer`.
- `return $obj` at the end of an advanced function. Instead: emit the object from `process {}`.
- Using `$?` to test for failure. Instead: `-ErrorAction Stop` and `try`/`catch`.
- A flag variable to decide whether to continue. Instead: put the whole block in the `try`.
- Relative paths such as `.\config.json` or `..\data`. Instead: build paths from `$PSScriptRoot`.
- A `switch` used as a jump table with an accidental fall-through. Instead: give each case an explicit `break` and a `default`.
- Writing validation logic in the function body. Instead: use parameter validation attributes.

## Code Example

```powershell
function Get-Order {
    <#
        .SYNOPSIS
            Retrieves a single order by its identifier.
        .PARAMETER OrderId
            The identifier of the order to retrieve.
    #>
    [CmdletBinding()]
    [OutputType([System.Management.Automation.PSCustomObject])]
    param(
        [Parameter(Mandatory = $true, Position = 0)]
        [ValidateNotNullOrEmpty()]
        [int]$OrderId
    )

    begin {
        $storePath = Join-Path -Path $PSScriptRoot -ChildPath 'orders.json'
    }

    process {
        if (-not (Test-Path -LiteralPath $storePath)) {
            throw "Order store '$storePath' does not exist."
        }

        $orders = Get-Content -LiteralPath $storePath -Raw | ConvertFrom-Json
        $order = $orders | Where-Object { $_.Id -eq $OrderId } | Select-Object -First 1

        if ($null -eq $order) {
            Write-Error "No order found with id $OrderId."
            return
        }

        [PSCustomObject]@{ Id = $order.Id; Customer = $order.Customer }
    }
}
```

## Sources

- https://github.com/PoshCode/PowerShellPracticeAndStyle
- https://github.com/PoshCode/PowerShellPracticeAndStyle/blob/master/Style-Guide/Code-Layout-and-Formatting.md
- https://github.com/PoshCode/PowerShellPracticeAndStyle/blob/master/Best-Practices/Error-Handling.md
- https://github.com/PowerShell/PSScriptAnalyzer
- https://pester.dev/docs/intro
