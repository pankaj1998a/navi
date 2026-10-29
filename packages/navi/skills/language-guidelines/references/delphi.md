# Delphi Style Guide

> Source: Delphi's Object Pascal Style Guide (https://docwiki.embarcadero.com/RADStudio/Alexandria/en/Delphi%E2%80%99s_Object_Pascal_Style_Guide) plus its White Space Usage and Comments pages, and the Embarcadero XML Documentation reference (https://docwiki.embarcadero.com/RADStudio/Alexandria/en/XML_Documentation_Comments)

## Quick Rules

- Indent with 2 spaces per level; never use tab characters.
- Put `begin`/`end`, `try`/`end`, and `record`/`end` on their own lines.
- Name classes with a `T` prefix, interfaces with `I`, and global variables with `g_`.
- Use mixed case for identifiers: `TMyClass`, `MyMethod`, `MyProperty`.
- Keep `unit`, `uses`, `type`, `var`, `implementation`, `initialization`, `finalization`, and the final `end` flush with the left margin.
- Use `{ }` for block comments and `//` for line comments; XMLDoc is `///`.
- Separate the method prototype from its body with a blank line; do not put blank lines inside a class declaration.
- Name the unit file after the unit: `MyUnit.pas` for `unit MyUnit`.
- Always check `TryStrToInt`, `TryStrToFloat`, and similar functions instead of parsing and catching.
- Use `raise Exception.Create('message')` and let the caller decide; never show a message box from library code.

## Formatting

- Indentation: 2 spaces for each nesting level; spaces only.
- The unit-level keywords (`unit`, `uses`, `type`, `var`, `const`, `implementation`, `initialization`, `finalization`, `end`) are flush with the margin; compiler directives (`{$IFDEF ...}`) are also flush with the margin.
- `begin`/`end` pairs are always on separate lines.
- `if ... then` / `else` with the `then`/`else` on the same line as the condition.
- Blank lines: after the copyright block, after the `uses` clause, between class declarations, between method implementations.
- No blank line inside a class or type declaration, and none between a prototype and its body.
- Blank spaces around operators, after commas in parameter lists, and after the semicolons in parameter declarations.
- No blank space between a method name and its `(`, before or after `.`, before a `;`, or around `(`/`)`/`[]`.
- Continuation lines are aligned and indented 2 spaces from the first line of the statement; a continuation line never starts with a binary operator.
- Lines should fit the editor width; 80 columns is the traditional target, longer is acceptable if it avoids horizontal scrolling.
- `uses` clauses are indented 3 spaces from the margin, one unit per line.

## Naming

- Units: `PascalCase`, singular, matching the file name (`unit MyUnit` in `MyUnit.pas`).
- Classes: `T` prefix + PascalCase (`TMyClass`); interfaces: `I` prefix (`IMyInterface`).
- Methods, properties, events: PascalCase (`DoWork`, `Count`, `OnChanged`).
- Local variables and parameters: PascalCase (`MyValue`) or a lower-case prefix (`myValue`); pick one per unit and stay consistent.
- Fields of a class: `F` prefix (`FCount`); private fields `FField`; with published fields, also `m` or `F` per project convention.
- Global variables: `g` prefix (`gCounter`); never global mutable state in a unit's interface section.
- Constants: `c` prefix (`cMaxItems`) or `UPPER_SNAKE` per project convention; pick one.
- Boolean properties read as assertions: `IsValid`, `HasData` (avoid `FValid` in the public API).
- Event handlers: `On<Something>`; the handler method is `Sender` + event name.
- Type names must not collide with the unit name (the `T` prefix solves this).

## Types and Data

- Declare classes in the interface section and implement them in the implementation section of a unit.
- Prefer `class function`/`class procedure` for constructors and factories.
- Use properties for public state; keep fields private where possible.
- Use `TObjectList<T>` and `TList<T>` from `System.Generics.Collections` for generic collections.
- Use `record` for simple value-like data with `class operator =` for comparison.
- Use `interface` for capability contracts and `class` for implementation.
- Avoid circular unit references; put shared declarations in a dedicated unit.
- Use `TObject` ancestry only when you need RTTI or streaming.

## Comments and Documentation

- A block comment `{ ... }` at the top of every unit holds the copyright and file description; words start on the line of the first brace.
- Line comments use `//` with one space after the slashes, placed at the indentation level of the code they describe.
- A blank line precedes a comment group unless it is the first thing in a block; a following blank line is needed only when the comment introduces a group of statements.
- Use XMLDoc `///` comments before public classes, methods, and properties for Intellisense.
- XMLDoc format: `/// <summary>...</summary>`, `/// <param name="X">...</param>`, `/// <returns>...</returns>`.
- There must be no blank line between the end of an XMLDoc comment and the symbol it documents.
- Avoid obvious comments; a misleading comment is worse than none.
- Avoid box-drawing comment frames and never put information in comments that will go stale.

## Error Handling

- Use `try...except` and `try...finally` for resource management; `finally` is mandatory for freeing objects.
- Catch the narrowest exception type you can handle: `except EMyError.Create('detail') do ...`.
- Re-raise with `raise;` to preserve the original exception; `raise EMyError.Create(...)` loses the stack.
- Validate inputs with `if not Assigned(X) then raise EArgumentNilException.Create('X');`.
- Prefer the `Try*` variants (`TryStrToInt`) over parsing plus exception handling.
- Never call `Application.MessageBox` or show other UI from a non-form unit.
- Let the exception propagate out of a library; only the presentation layer converts it into a message.

## Testing

- Keep tests in a separate unit or project, e.g. `MyUnitTests.pas`, using DUnitX or FPCUnit.
- Test class names end with `Test`: `TMyClassTest`.
- Test method names describe the scenario: `Test_Add_Negative_ReturnsError`.
- Use `[Test]` attributes for DUnitX and assert with `Assert.AreEqual` / `Assert.IsTrue`.
- One behaviour per test method so failures are easy to localize.
- Set up fixtures in `SetUp` and tear them down in `TearDown`.
- Cover the failure paths: nil arguments, empty collections, boundary values.

## Anti-Patterns

- Tab characters for indentation. Instead: 2 spaces, configured in the IDE formatter options.
- `StrToInt(S)` without checking. Instead: `TryStrToInt(S, V)` and handle the failure.
- Showing a message box from a utility unit. Instead: raise an exception and let the UI layer handle it.
- A public class field. Instead: expose a property and keep the field private.
- Global variables in the interface section. Instead: scope the state to the owning object.
- `{$IFDEF}` blocks scattered through a unit. Instead: group platform-specific code into separate units.
- `Result := TrySomething` where the caller must guess the meaning. Instead: use an explicit result type or an out parameter.

## Code Example

```pascal
unit MyUnit;

interface

type
  /// <summary>Represents a validated customer record.</summary>
  TCustomer = class
  private
    FName: string;
    FEmail: string;
    function GetIsValid: Boolean;
  public
    /// <summary>Creates a customer.</summary>
    /// <param name="AName">The customer's name.</param>
    /// <param name="AEmail">The customer's email address.</param>
    constructor Create(const AName, AEmail: string);
    /// <summary>The customer's display name.</summary>
    property Name: string read FName;
    /// <summary>True when the customer has both a name and an email.</summary>
    property IsValid: Boolean read GetIsValid;
  end;

implementation

constructor TCustomer.Create(const AName, AEmail: string);
begin
  FName := Trim(AName);
  FEmail := Trim(AEmail);
end;

function TCustomer.GetIsValid: Boolean;
begin
  Result := (FName <> '') and (Pos('@', FEmail) > 0);
end;

end.
```

## Sources

- https://docwiki.embarcadero.com/RADStudio/Alexandria/en/Delphi%E2%80%99s_Object_Pascal_Style_Guide
- https://docwiki.embarcadero.com/RADStudio/Alexandria/en/White_Space_Usage
- https://docwiki.embarcadero.com/RADStudio/Alexandria/en/Delphi_Comments
- https://docwiki.embarcadero.com/RADStudio/Alexandria/en/XML_Documentation_Comments
