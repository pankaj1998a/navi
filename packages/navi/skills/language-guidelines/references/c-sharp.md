# C# Style Guide

> Source: .NET Coding Conventions - C# (https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/coding-conventions) plus C# Style Guide (https://github.com/kodecocodes/c-sharp-style-guide) and C# Coding Standards and Naming Conventions (http://www.dofactory.com/reference/csharp-coding-standards)

## Quick Rules

- Use four spaces for indentation, never tabs; keep lines to about 65-100 characters.
- Use Allman braces: the opening brace of a block goes on its own line.
- Use the language keywords for types: `string`, `int`, `object`, not `String`, `Int32`, `Object`.
- Prefer `int` over unsigned types unless the unsignedness is part of the contract.
- Use `var` only when the type is obvious from the right-hand side.
- Place `using` directives outside the namespace declaration, and file-scoped namespaces where possible.
- Name types, methods, and properties in PascalCase; locals and parameters in camelCase.
- Never catch `System.Exception` without an exception filter, and never swallow an exception silently.
- Prefer `async`/`await` over raw `Task` continuations for I/O-bound work.
- Use `required` properties and object initializers instead of constructor boilerplate.

## Formatting

- Indentation: 4 spaces, no tab characters.
- Braces: Allman style - `{` on its own line, aligned with the current indentation level.
- Line length: the .NET docs convention is 65 characters; most teams use 100-120. Pick one and set it in `.editorconfig`.
- One statement per line; one declaration per line.
- Continuation lines are indented one tab stop (4 spaces).
- At least one blank line between method and property definitions.
- Parenthesize sub-expressions to make precedence obvious: `if ((startX > endX) && (startX > previousX))`.
- Place `using` directives at the top of the file, outside the namespace; order: `System` namespaces first, then others alphabetically.
- Use a file-scoped namespace (`namespace MySampleCode;`) when the file holds one namespace.
- No trailing whitespace; files end with a newline; use UTF-8.

## Naming

- Types, classes, structs, interfaces, enums, delegates: `PascalCase`.
- Methods, properties, events, constants: `PascalCase`.
- Parameters, locals, fields (when public): `camelCase`.
- Private instance fields: `_camelCase` with an underscore prefix.
- Interfaces: prefix `I` (`IDisposable`).
- Generic type parameters: `T`, `TKey`, `TValue`; use descriptive names for multiple parameters.
- Booleans: read as assertions, e.g. `isValid`, `hasChildren`, `shouldRetry`.
- Events: name the event for the past tense action (`ValueChanged`) and the handler `OnValueChanged`.
- Async methods: suffix `Async` (`FetchAsync`).
- Acronyms follow .NET rules: `Xml`, `Html`, `Id` - not `XML`, `HTML`, `ID`.

## Types and Data

- Prefer `var` for locals when the type is evident (`new()`, literal, cast); otherwise state the type explicitly.
- Use collection expressions (`string[] vowels = ["a", "e", "i"];`) for collection initialization.
- Use `Func<>` and `Action<>` instead of declaring custom delegate types when possible.
- Mark single-argument constructors and conversion operators `explicit`.
- Use `record` for immutable data carriers, `class` for behaviour with identity.
- Use `init` accessors and `required` members to force correct initialization.
- Prefer `Nullable<T>` and nullable reference types; never return `null` for a collection.
- Use `IReadOnlyList<T>` for parameters and `IEnumerable<T>` for sequences.

## Comments and Documentation

- Use XML doc comments (`///`) for all public members, types, and parameters.
- Place the doc comment on its own line above the declaration, not at the end of a line.
- Start the summary with a capital letter and end it with a period; separate the summary from the rest with a blank `///` line.
- Use `/// <param name="x">`, `/// <returns>`, `/// <exception cref="...">` for details.
- Use `//` for brief inline explanations; avoid `/* */` for multi-line prose.
- Keep explanations in prose, not in heavily marked-up markdown inside doc comments.
- Use `TODO:` comments for pending work and keep them attached to the code they concern.

## Error Handling

- Use `try`/`catch` for expected failures; `catch (Exception)` without a filter is only acceptable when you rethrow.
- Catch the most specific exception type you can handle and give a meaningful message.
- Use `throw;` to rethrow preserving the stack trace; never `throw ex;`.
- Do not catch `Exception` in a library and return a default value - it hides bugs.
- Validate arguments in public methods with `ArgumentNullException.ThrowIfNull` and `ArgumentOutOfRangeException`.
- Prefer returning `Result`-like tuples or `TryParse` patterns for parsing failures.
- Use `ConfigureAwait(false)` in library code to avoid deadlocks.

## Testing

- Keep tests in a separate project, e.g. `MyApp.Tests`, with one class per tested unit.
- Use xUnit (or NUnit); name test methods `MethodName_Scenario_ExpectedResult`.
- Arrange / Act / Assert with blank lines between the three phases.
- Prefer data-driven tests (`[Theory]`/`[InlineData]`) over repeated near-identical test methods.
- Use a mocking library (NSubstitute, Moq) for external dependencies; do not mock types you own.
- Assert on observable behaviour and public results, not on internal call sequences.
- Cover the failure paths: invalid input, missing dependency, timeout.

## Anti-Patterns

- `using System;` inside the namespace. Instead: put `using` directives above the namespace declaration.
- Using `var` everywhere. Instead: use `var` only when the type is obvious from the right-hand side.
- `catch (Exception) { }`. Instead: catch a specific type and log or rethrow.
- `public string Name { get; set; }` when the value should never change. Instead: `public string Name { get; init; }`.
- A class with only static members. Instead: use a static class or plain functions in a namespace.
- `Thread.Sleep` to wait for async work. Instead: `await` the task.
- Custom delegate declarations for common shapes. Instead: use `Func<>` and `Action<>`.
- Boolean parameters on public methods. Instead: pass a dedicated options object or overload the method.

## Code Example

```csharp
using System;
using System.Threading.Tasks;

namespace MyApp.Inventory;

/// <summary>Reads product stock levels from the warehouse service.</summary>
public sealed class StockRepository
{
    private readonly IWarehouseClient _client;

    /// <summary>Creates a repository over the given warehouse client.</summary>
    public StockRepository(IWarehouseClient client)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
    }

    /// <summary>Gets the stock level for the given product identifier.</summary>
    /// <param name="productId">The product identifier to look up.</param>
    /// <returns>The number of units currently in stock.</returns>
    /// <exception cref="ProductNotFoundException">Thrown when the product is unknown.</exception>
    public async Task<int> GetStockAsync(string productId)
    {
        if (string.IsNullOrWhiteSpace(productId))
        {
            throw new ArgumentException("A product id is required.", nameof(productId));
        }
        var record = await _client.FetchAsync(productId).ConfigureAwait(false);

        if (record is null)
        {
            throw new ProductNotFoundException(productId);
        }
        return record.Quantity;
    }
}
```

## Sources

- https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/coding-conventions
- https://github.com/kodecocodes/c-sharp-style-guide
- http://www.dofactory.com/reference/csharp-coding-standards
