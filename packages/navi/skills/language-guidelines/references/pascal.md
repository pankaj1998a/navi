# Pascal Style Guide

> Source: GNU Pascal Coding Standards (https://edoras.sdsu.edu/doc/gpcs-en.html). The Free Pascal wiki page listed in the awesome list (`http://wiki.freepascal.org/Coding_style`) is behind an anti-bot wall and could not be read, so the GNU Pascal Coding Standards are used as the primary source. They extend the GNU Coding Standards (https://www.gnu.org/prep/standards/) with Pascal-specific rules.

## Quick Rules
- Write reserved words in lower case: `begin`, `end`, `if`, `then`, `procedure`.
- Capitalise the first letter of every user identifier; capitalise each word in a multi-word name, but never use underscores: `BlockRead`, `WriteLn`, `IOResult`.
- Indent with 2 spaces and never save a file with tab characters.
- Use braces for comments (`{ ... }`); do not use `(* ... *)` or `//`. Write comments in English, on their own line above the code they describe.
- Order declaration blocks: `const`, `type`, `var`, `label`, then routines. Test a Boolean directly: `if Foo then`, never `if Foo = True then`.
- Avoid `goto`, `Exit`, `Break`, and `Continue` where a restructured loop condition works. Never modify a `for` loop counter or rely on its value after the loop.
- Check the result of every system call; in Pascal many I/O routines fail silently unless you check `IOResult`. Use `Assert` to check internal consistency at the start of a routine.
- File names are lower case with the `.pas` suffix, one program or unit per file.

## Formatting
- Indentation: 2 spaces. Never use tabs - different editors expand them differently and break the layout. Maximum line length: 68 characters (prints on A4 with default TeX) or 78 for an 80-column screen.
- No trailing whitespace on any line. No control characters other than newline - in particular no form feeds and no SUB (0x1A) markers.
- Use empty lines between blocks: long comments, `type`, `const`, `var`, `label` sections, routine bodies, unit initialisers. Put a blank line between subroutines, but not between the blocks inside a single routine. No blank line at the beginning or end of a file; exactly one newline at the end.
- One space after the opening brace and before the closing brace of a comment.
- Do not surround a single statement with `begin`/`end` unless you must avoid the dangling-`else` problem.
- Do not use the trailing `;` before `end`, `until`, or `else` - except after the last branch of a `case` statement, where the `;` is required.

## Naming
- Reserved words and compiler directives: lower case (`{$gnu-pascal}`).
- Types: `T` prefix for the main type, `P` prefix for the pointer type - `TMyInt`, `PMyInt`, `TStrList`, `PStrList`.
- Record fields: descriptive nouns, matching the surrounding capitalisation style. The first field of a recursive type is the pointer to the next element. Routines: `UpperCamelCase` verbs - `BlockRead`, `WriteLn`, `CopyFile`.
- Variables and parameters: `UpperCamelCase` for globals and exported names; very short names like `i` or `s1` are acceptable only for local variables and for parameters of global routines. Constants: same rule as other identifiers - `UpperCamelCase`, no underscores. Enumeration values and grouped constants may carry a two-letter lower-case prefix plus underscore: `fb_Foo`, `mf_Bar`.
- File names: lower case, `.pas` extension, matching the unit or program name. Do not use identifiers starting or ending with an underscore, and do not overload a built-in identifier.
- A parameter that mirrors an object field should be "mangled" so the field keeps its natural name.

## Types and Data
- Declare the pointer type before the record type it points to, so recursive structures are visible. Put the dialect directive near the top of the unit; use `{$mode objfpc}` or the equivalent for the compiler, and prefer `{$gnu-pascal}` in units so they compile without dialect options.
- Use `{$I-}` or `{$local I-}` to disable automatic I/O aborts, then check `IOResult` explicitly.
- Declare the result variable of a function explicitly rather than relying on the automatic `Result` variable, and use the `=` form of the function declaration: `function Foo(...): Integer;`. Use `Boolean` results where `True` means success and `False` means failure - the opposite of some C conventions.
- Avoid untyped parameters and hand-rolled file-name routines; use the standard library equivalents. Avoid `FillChar` and `Move` except in low-level code; `s := ''` is the correct way to clear a string. Do not assume type sizes or endianness.

## Comments and Documentation
- Comments use braces: `{ This is a nice comment. }`. Do not use `(* ... *)` or `//`. One space after the opening brace and before the closing brace.
- Put a comment on its own line above the code it describes, at the same indentation level. A trailing comment is allowed for a single-line remark, separated by two spaces. Write comments in English.
- Do not write "trivial" comments that merely restate the code. Comment "tricky" code: non-obvious assumptions, side effects, and things that must change together. Never refer to a line number in a comment; refer to the routine name instead.
- Use a fixed section marker to split large units: `{@section Name}` and `{@subsection Name}` (no space after the brace). "Fixme" comments begin with at least two `@` characters, more for greater urgency: `{ @@fjf226 }`. Do not leave commented-out code in a published file.

## Error Handling
- Pascal's I/O routines abort by default. To handle errors, disable the automatic abort with `{$I-}` (preferably `{$local I-}`), perform the operation, and check `IOResult` or `InOutRes`.
- Check the result of every system call that can fail: `Rewrite`, `Reset`, `Open`, `BlockRead`, `BlockWrite`.
- Report errors to `StdErr` and exit with a nonzero status; include the program name, the failed call, and the standard system error message. Use `Assert` to check internal assumptions at the start of a routine. Assertions cause a runtime error that can be caught with the `Trap` unit, and can be disabled at compile time with `--no-assertions` without a source change.
- Do not rely on undefined behaviour, such as assuming globals are zero-initialised or that freed memory still holds its old value.
- Avoid `Exit` and `Break` where an extra Boolean or a restructured loop condition would do; a `repeat ... until False` loop is the GNU Pascal idiom for an infinite loop.

## Testing
- Frameworks: FPCUnit is the standard unit-testing framework for Free Pascal; there is no universally adopted standard for Delphi.
- Layout: a `tests` directory with one test program or unit per source unit, named `test<unitname>.pas` or `test_<unitname>.pas`.
- Test procedure names read as sentences: `procedure TestParseConfigValid;` and `procedure TestParseConfigMissingKey;`. Use a fixture base class (`TTestCase` in FPCUnit) with `SetUp` and `TearDown` overrides for shared setup, and `Check`, `CheckEquals`, and `AssertTrue` rather than raw `Assert`.
- Cover the failure paths: every I/O routine that can fail should have a test that forces the failure and checks the reported error.
- Keep test procedures in the implementation section of a dedicated test unit so they do not ship in the production binary.

## Anti-Patterns
- `if Foo = True then` - instead `if Foo then`; and `if Foo = False then` becomes `if not Foo then`.
- `(* comment *)` or `// comment` - instead `{ comment }`.
- A `goto` to escape a nested loop - instead use a Boolean flag or restructure the condition.
- `while True do begin ... end` - instead `repeat ... until False`, which indents less.
- `Exit`, `Break`, or `Continue` used to skip the rest of a loop body - instead restructure the loop.
- Modifying the `for` loop counter inside the loop - instead copy it into a local variable.
- An empty unit initialiser (`begin end.`) at the end of a unit - instead omit it.
- `FillChar(S, SizeOf(S), 0)` to clear a string - instead `S := ''`.

## Code Example
```pascal
{ Compute statistics over a numeric data file. }

program Stats;
{$gnu-pascal}
{$I-}

type
  TIntArray = array[0..999] of Int64;

procedure LoadValues(const FileName: AnsiString; var AValues: TIntArray;
    var ACount: SizeInt);
{ Load the integers stored in FileName into AValues; returns the count. }
var
  F: Text;
  Item: AnsiString;
  Code: Integer;
  Value: Int64;
begin
  ACount := 0;
  {$local I-}
  Assign(F, FileName);
  Reset(F);
  {$endlocal}
  if IOResult <> 0 then
    begin
      WriteLn(StdErr, 'Stats: cannot open ', FileName);
      Halt(1);
    end;
  while not Eof(F) do
    begin
      Read(F, Item);
      Val(Item, Value, Code);
      if Code <> 0 then
        begin
          Close(F);
          WriteLn(StdErr, 'Stats: ', Item, ' is not an integer');
          Halt(1);
        end;
      AValues[ACount] := Value;
      Inc(ACount);
    end;
  Close(F);
end;

begin
  { ... report the statistics ... }
end.
```

## Sources
- https://edoras.sdsu.edu/doc/gpcs-en.html
- https://www.gnu.org/prep/standards/standards.html
- http://wiki.freepascal.org/Coding_style (not reachable at the time of writing; covered by the GNU standards above)
- https://www.freepascal.org/docs-html/rtl/units.html
