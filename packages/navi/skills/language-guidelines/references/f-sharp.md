# F# Style Guide

> Source: F# component design guidelines (https://learn.microsoft.com/en-us/dotnet/fsharp/style-guide/component-design-guidelines) plus the F# coding conventions (https://learn.microsoft.com/en-us/dotnet/fsharp/style-guide/conventions) and the .NET Library Design Guidelines (https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/)

## Quick Rules

- Follow the .NET naming conventions: types, unions cases, methods, and properties are `PascalCase`; parameters are `camelCase`.
- F#-facing `let` functions may be `camelCase` or `PascalCase`; be consistent within a module.
- Every file starts with a `namespace` or `module` declaration.
- Use XML documentation comments (`///`) for public APIs.
- Prefer immutable records and discriminated unions over mutable classes.
- Model expected failures with `Result`/`option`, and raise exceptions only for exceptional cases.
- Prefer discriminated unions to class hierarchies for tree-shaped data.
- Use `[<RequireQualifiedAccess>]` on modules that extend `FSharp.Core` modules such as `List` and `Seq`.
- Hide the representation of records and unions whose shape is likely to evolve (private union cases or a `.fsi` signature file).
- Avoid custom symbolic operators in public APIs; publish named functions.

## Formatting

- Indentation: 4 spaces (the `fantomas` default and Visual Studio default).
- Line length: 120 characters is the Visual Studio default; keep lines under 100 where practical.
- Opening braces of records, classes, and modules are placed on the same line as the declaration; type members are indented one level.
- No tabs; Unix line endings; files end with a newline.
- One binding per line; do not cram multiple `let` bindings on one line.
- Blank line between top-level bindings and between type definitions.
- Record fields are aligned in a column; long records are formatted one field per line with the braces on their own lines.
- Match cases are indented under the `match` keyword; pattern alternatives align.
- Use `//` comments; XMLDoc uses `///`.

## Naming

- Concrete types (records, classes, unions, enums, structs): `PascalCase`, noun or adjective (`List`, `Double`, `Complex`).
- Union cases: `PascalCase`, no prefix in public APIs (`Some`, `Success`, `Error`).
- Interfaces: `PascalCase` with an `I` prefix (`IDisposable`).
- Exceptions: `PascalCase` ending in `Exception` (`WebException`).
- Methods: `PascalCase`, verb-first (`ToString`, `Compute`).
- Properties: `PascalCase`, noun (`IsEndOfFile`, `BackColor`); booleans use a positive `Is`/`Can` prefix.
- Events: `PascalCase`, verb (`ValueChanged`).
- Parameters: `camelCase` (`typeName`, `transform`, `range`).
- Generic type parameters: `PascalCase` (`T`, `U`, `Key`, `Value`).
- Namespaces: `PascalCase` (`Microsoft.FSharp.Core`); prefer `<Organization>.<Technology>[.<Subnamespace>]`.
- DLL names: `PascalCase` (`Fabrikam.Core.dll`).
- Avoid abbreviations; well-known acronyms are written as `Xml`, `Html`, `Id`.

## Types and Data

- Use discriminated unions for closed sets of states; pattern matching then becomes exhaustive.
- Use records for structured data with named fields; keep them immutable unless the API demands mutation.
- Use classes to encapsulate mutable state; use `let mutable` inside the class body, never at module level.
- Use interfaces to group operations instead of records of functions.
- Use modules to group functions that act on a collection (`CollectionType.map`, `CollectionType.iter`).
- Hide representation with `private` union cases or a signature file when the shape may change.
- Use `async`/`Async<'T>` at F# boundaries; expose `Task<'T>` to other .NET languages.
- Avoid type abbreviations for public types whose members differ from the abbreviated type.
- Use units of measure where they add type safety, remembering other .NET languages see plain `float`.

## Comments and Documentation

- Use XML documentation comments (`///`) for every public type and member; `///<summary>...</summary>` is also supported.
- Place the doc comment directly above the declaration it describes.
- Document parameter and return values in prose.
- Use `//` for implementation comments that explain why, not what.
- Keep comments in sync with the code; a stale comment is worse than none.

## Error Handling

- Use `Result<T, Error>` for expected failures and `option<'T>` for optional values.
- Raise exceptions only for programming errors or genuinely exceptional conditions.
- Prefer `invalidArg` for argument validation and `failwith` for impossible states.
- Never use `null` for F# types; check for `null` only at .NET interop boundaries and use the `null` pattern to reject it.
- Do not catch `Exception` broadly; match on specific exception types.
- In a vanilla .NET API, prefer the `TryGetValue` pattern over returning `option` values.

## Testing

- Use xUnit, NUnit, or Expecto; most F# projects on .NET use xUnit with `[<Fact>]` and `[<Theory>]`.
- Name test files after the module under test: `Tests/CounterTests.fs`.
- Name test functions as descriptive strings: `[<Fact>] let ``Increment increases the count`` () = ...`.
- Arrange / Act / Assert with blank lines between phases.
- Keep one behaviour per test; use `[<Theory>]` with `InlineData` for table-driven cases.
- Test discriminated unions by pattern matching on the result rather than on internal fields.
- Keep test modules in a separate project that references the library.

## Anti-Patterns

- `type pCoord = ...` with lowercase type names. Instead: use `PascalCase` for .NET-facing types.
- Exposing union cases publicly when the shape may evolve. Instead: make the cases `private` or expose active patterns.
- Using a class hierarchy for tree-structured data. Instead: use a discriminated union.
- Returning `option` from a vanilla .NET API. Instead: use the `TryGetValue` pattern with an out parameter.
- Using `List<'T>` in a vanilla .NET signature. Instead: use `seq<'T>` / `IEnumerable<'T>`.
- Defining custom operators for a public API. Instead: publish named functions.
- `null` literals inside F# code. Instead: use `option` and check `null` only at interop boundaries.
- Mutable module-level `let` bindings. Instead: encapsulate the state in a class.

## Code Example

```fsharp
namespace Fabrikam.Geometry

/// A point in two dimensional space.
type Point =
    { X: float
      Y: float }

/// Operations on points.
module PointOps =
    /// Computes the distance between two points.
    let distance (a: Point) (b: Point) =
        let dx = a.X - b.X
        let dy = a.Y - b.Y
        sqrt (dx * dx + dy * dy)

/// The result of a geometry operation.
type GeometryResult =
    | Valid of Point
    | Invalid of string

/// A service that computes geometry operations.
type GeometryService() =
    let mutable operationCount = 0

    /// The number of operations performed so far.
    member _.OperationCount = operationCount

    /// Computes the distance, reporting errors as data.
    member this.Distance(a: Point, b: Point) : GeometryResult =
        operationCount <- operationCount + 1
        if System.Double.IsNaN(a.X) || System.Double.IsNaN(b.X) then
            Invalid "Coordinates must not be NaN"
        else
            Valid { X = PointOps.distance a b
                    Y = 0.0 }
```

## Sources

- https://learn.microsoft.com/en-us/dotnet/fsharp/style-guide/component-design-guidelines
- https://learn.microsoft.com/en-us/dotnet/fsharp/style-guide/conventions
- https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/
