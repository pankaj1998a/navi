# Visual Basic Style Guide

> Source: Visual Basic/Coding Standards (https://en.wikibooks.org/wiki/Visual_Basic/Coding_Standards) plus Visual Basic Concepts (https://msdn.microsoft.com/en-us/library/aa240822(v=vs.60).aspx)

## Quick Rules

- Always include `Option Explicit` at the top of every module.
- Indent 3 spaces per level (per the Wikibook standard); never use tabs.
- Variables are named `scope + type + Name` - `nCustomerCode`, `sCustomerName`, `mOrderTotal`.
- Functions and procedures are named `VerbNoun` - `FindCustomer`, `UpdateCustomer`.
- Use `Sub` for procedures with no return value and `Function` with an explicit `As` type otherwise.
- Declare every variable with `Dim ... As <Type>`; never rely on `Variant`.
- Pass input parameters `ByVal`; use `ByRef` only when the procedure must modify the caller's value.
- Write the nominal (normal) path first in `If` blocks; put the normal case in the `Then` branch.
- Use `Select Case` instead of chains of `If` when testing a single value against many options.
- Every major routine gets a header comment block describing purpose, parameters, and return value.

## Formatting

- Indent 3 spaces per level. Set the editor to insert spaces, never tab characters.
- One space around operators and after commas: `Let nTotal = 1 + 2 * (nValue - 6)`.
- Statements on separate lines; the optional `Let` keyword is not used.
- The `Call` keyword is deprecated - invoke a `Sub` by naming it: `ProcessRecord`.
- `If ... Then` / `Else` / `End If` on separate lines; `Select Case` / `Case` / `End Select` on separate lines.
- `Case` clauses in a `Select Case` are not indented; the statements they control are indented one level. The alternative is to indent `Case` clauses two or three spaces and super-indent the bodies - pick one per file.
- Limit nesting to three levels of control structures.
- Blank line between procedure declarations. Use `'` for comments, never decorative `****` comment boxes.

## Naming

- Variable name = optional scope prefix + type prefix + CamelCase body - `gnCustomerCode`, `txtCustomerName`, `mOrderTotal`.
- Scope prefixes: `g` for global, `m` for module or form level; no prefix for a local.
- Type prefixes: `i` Integer, `l` Long, `s` String, `n` Numeric, `c` Currency, `v` Variant, `b` Boolean, `dbl` Double, `sng` Single, `flt` Float, `byte` Byte, `obj` Object, `ctl` Control, `h` Handle, `dte` Date.
- Parameters get a suffix: `_IN` for input, `_OUT` for output, `_INOUT` for both - `nCustomerCode_IN`, `sCustomerName_OUT`.
- Procedures: `VerbNoun` - `FindCustomer`, `LookupCustomer`, `UpdateCustomerCur`. Functions carry the type prefix of their return value: `sFormatCurrency(...)`.
- UDT (user-defined type) names start with `T`: `Type TCustomer`.
- Control prefixes: `cbo`, `chk`, `cmd`, `frm`, `lbl`, `lst`, `mnu`, `opt`, `pic`, `txt`, `tim`. Menu controls use the full path: `mnuFileNew`.
- Constants are `ALL_UPPER_CASE`; shared-module constants take a unique group prefix: `WDGT_STATUS_OK`.
- Body words are nouns with modifiers placed after: `AmountDue`, `StatusEnabled`, `VolumeHigh`.

## Types and Data

- Declare types explicitly: `Dim nCount As Integer`, never `Dim nCount`.
- Prefer strongly typed declarations over `Variant`; use `Variant` only for genuinely dynamic values.
- Store dates in a `Date`-typed variable (`dteDueDate`), not a `Double`.
- Use `Option Explicit` so typos in variable names are compile-time errors.
- Declare arrays with both bounds: `Dim mCustomers(0 To 10) As TCustomer`.
- Use `As` clauses on user-defined types and object variables.
- Set object references with `Set` and `Nothing`; use `Is Nothing` for comparison.
- Pass user-defined types and arrays `ByRef`; pass scalars `ByVal`.

## Comments and Documentation

- Every major routine gets a header comment block listing: purpose, author, parameters (input and output), return value, assumptions, and revision history.
- The header must not describe *how* the routine works - only the contract.
- In-line comments explain what you are doing, where you are, why you chose an approach, or an external factor to remember. Never restate the code.
- End-of-line comments are small annotations attached to one or two lines; separate them from the code with at least two spaces.
- Use `'` for all comments. Never draw comment boxes with repeated `*` or `-` characters.
- Keep comments in sync with the code; a stale comment is worse than none.

## Error Handling

- Add an error handler to every procedure unless you are certain it cannot fail: `On Error GoTo <Procedure>_Error`.
- Use the `Procedure_Exit` / `Procedure_Error` label pattern so cleanup is written once.
- Route unhandled errors to a shared `DefErrorHandler` routine that logs the error and shows a message.
- Use `Select Case Err.Number` in the handler for errors handled locally.
- `On Error Resume Next` is only for a narrowly scoped region, followed by an explicit `If Err Then` check.
- Re-enable the handler with `On Error GoTo HandleError` after a local `Resume Next` region.
- Do not use `Goto` except for the error-handler and exit-label pattern, or to escape a deeply nested structure that should be decomposed.

## Testing

- Framework: for classic VB use the Visual Basic Testing Edition / VBScript; for VB.NET use MSTest, NUnit, or xUnit.
- Layout: keep tests in a separate project or folder - `Tests\OrderTests.cls` or `Tests\OrderRepositoryTests.vb`.
- Name test classes after the unit under test with a `Tests` suffix; name test methods after the scenario: `TestCustomerLookupReturnsMatch`.
- Arrange / Act / Assert, separated by blank lines and by a comment marker if desired.
- Assert on observable behaviour, not on internal field values.
- Mock only external dependencies (COM objects, file system, databases); prefer real objects.
- Every bug fix should come with a regression test.

## Anti-Patterns

- Missing `Option Explicit`. Instead: always declare it, and always `Dim ... As <Type>`.
- Undeclared or `Variant` variables. Instead: give every variable an explicit type.
- `Call DoSomething`. Instead: invoke the sub directly - `DoSomething`.
- A chain of `If`/`ElseIf` testing one value. Instead: use `Select Case`.
- `Goto` used to jump around normal logic. Instead: restructure into smaller procedures.
- Comment boxes drawn with `****`. Instead: plain comment lines.
- Comments that restate the code. Instead: delete them or explain the reasoning.
- A procedure that both computes a value and performs side effects. Instead: split into a `Function` and a `Sub`.

## Code Example

```vb
Option Explicit

'------------------------------------------------------------------
' LookupCustomer
'------------------------------------------------------------------
' Purpose : Find a customer by their customer code.
'
' Parameters
'   nCustomerCode_IN : The customer code to search for.
'
' Returns : A TCustomer structure, or Nothing when not found.
'------------------------------------------------------------------
Public Function LookupCustomer(ByVal nCustomerCode_IN As Long) As TCustomer
    Dim oRecordset As ADODB.Recordset
    Dim tCustomer As TCustomer

    Set oRecordset = SelectCustomerByCode(nCustomerCode_IN)
    If oRecordset.EOF Then
        Set LookupCustomer = Nothing
        Exit Function
    End If

    tCustomer.nCode = oRecordset.Fields("code").Value
    tCustomer.sName = oRecordset.Fields("name").Value
    tCustomer.dblBalance = oRecordset.Fields("balance").Value

    Set LookupCustomer = tCustomer
End Function
```

## Sources

- https://en.wikibooks.org/wiki/Visual_Basic/Coding_Standards
- https://en.wikibooks.org/w/index.php?title=Visual_Basic/Coding_Standards&action=raw
- https://msdn.microsoft.com/en-us/library/aa240822(v=vs.60).aspx
