# .NET Style Guide

> Source: .NET Naming Guidelines (https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/naming-guidelines) plus the supporting chapters of the same Framework Design Guidelines: Capitalization Conventions (https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/capitalization-conventions), General Naming Conventions (https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/general-naming-conventions), and Names of Type Members (https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/names-of-type-members). These apply to every CLR language (C#, F#, VB.NET) and to any library that other languages will consume.

## Quick Rules
- PascalCase for every public type, member, and namespace: `PropertyDescriptor`, `HtmlTag`. camelCase for parameter names only: `propertyDescriptor`, `htmlTag`.
- Never use underscores, hyphens, or other non-alphanumeric characters in identifiers, and never use Hungarian notation (`strName`, `iCount`, `m_field`).
- Methods are verbs or verb phrases; properties and fields are nouns or noun phrases.
- Use the CLR type name, not the language-specific alias: `ToInt64`, not `ToLong`; `Single`, not `Float`.
- Avoid abbreviations and contractions: `GetWindow`, not `GetWin`.
- Do not rely on case-sensitivity to distinguish names; CLS compliance forbids it.
- Boolean properties read affirmatively: `CanSeek`, not `CantSeek`.
- Event handlers take exactly two parameters named `sender` and `e`; event args classes end in `EventArgs`.
- Do not expose public instance fields; expose properties, and never name a property `GetX` when it is really a method.
- Document every public member with XML documentation comments.

## Formatting
- Indentation: 4 spaces. Never tabs.
- Line length: 120 characters is a reasonable target for C#; keep lines shorter where practical.
- Braces: Allman style is the .NET convention - the opening brace goes on its own line, the closing brace on its own line at the declaration's indentation.
- One statement per line; always terminate with a semicolon.
- `using` directives at the top of the file, outside the namespace, sorted alphabetically. `System.*` namespaces first.
- Prefer file-scoped namespaces (`namespace Foo.Bar;`) in modern C#. One public type per file, file named after the type.
- No trailing whitespace; file ends with a newline. UTF-8 encoding.
- `this.` prefix only when it is required for disambiguation, not for every member access.
- XML doc comments on public members; `///` summary lines start with a capital letter and end with a period.

## Naming
- Namespace: PascalCase, dot-separated, matching the assembly and folder structure: `System.Security`, `MyCompany.MyProduct.Examples`.
- Class, struct, interface, enum, delegate: PascalCase, noun or noun phrase - `StreamReader`, `IEnumerable`. Interface: PascalCase with an `I` prefix - `IDisposable`.
- Method: PascalCase, verb or verb phrase - `ToInt32`, `CompareTo`, `Trim`. Property: PascalCase, noun or adjective - `Length`, `IsReadOnly`. Event: PascalCase, verb with a tense pair - `Closing` (before) and `Closed` (after).
- Event handler delegate type: PascalCase with the `EventHandler` suffix - `ClickedEventHandler`. Event args class: PascalCase with the `EventArgs` suffix - `MouseEventArgs`.
- Field: PascalCase, noun phrase. No `g_` or `s_` prefix. Constant: PascalCase - `InfiniteTimeout`, not `INFINITE_TIMEOUT`. Parameter: camelCase - `value`, `index`. Local variable: camelCase. Generic type parameter: `T` for a single type, `TKey`/`TValue` for pairs.
- Closed-form compound words are treated as one word: `FileName` not `Filename`, `Hashtable` not `HashTable`, `UserName` not `Username`, `Metadata` not `MetaData`, `SignIn` not `SignOn`, `Endpoint` not `EndPoint`.
- Acronyms of two letters are fully uppercase (`IOStream`); longer acronyms are capitalised once (`XmlFormatter`).

## Types and Data
- Use `struct` for small, immutable value types with no inheritance needs; use `class` otherwise. Do not seal a class unless you intend to prevent derivation. Use `readonly struct` and `record` for immutable data carriers.
- Declare public API members with explicit accessibility, and always specify an explicit return type on a public method so the contract cannot change silently.
- Use `Nullable<T>` / `T?` for value types that may be absent; use `null` only for reference types.
- Prefer `IReadOnlyList<T>` / `IEnumerable<T>` for parameters that are not mutated, and do not expose the concrete collection type unless callers need to mutate it.
- Use `IEquatable<T>` and implement `Equals`/`GetHashCode` together for value semantics. Prefer an `Enum` with explicit values over magic numbers. Use `nameof` instead of a string literal for a member name in an exception or argument check.
- Implement `IDisposable` when a type owns an unmanaged or disposable resource; follow the dispose pattern. Make types immutable by default: expose `readonly` fields and no setters.

## Comments and Documentation
- XML documentation comments (`/// <summary>...</summary>`) on every public type, member, and parameter of a library.
- The summary is one sentence, capitalised, ending with a period, and is not a bare noun-phrase fragment. Add `<param>`, `<returns>`, `<exception>`, and `<value>` elements where they add information; do not repeat the name mechanically.
- Use `<remarks>` for longer prose and `<see cref="TypeName"/>` for cross-references rather than repeating the type name. Implementation comments use `//`; XML doc comments only for the public surface. Comments explain why, not what.
- TODO format: `// TODO(owner): description`. Delete commented-out code.

## Error Handling
- Throw the most specific standard exception type: `ArgumentNullException`, `ArgumentOutOfRangeException`, `InvalidOperationException`, `NotSupportedException`, `ObjectDisposedException`.
- Include the offending value and the expected constraint in the message: `throw new ArgumentOutOfRangeException(nameof(count), count, "Count must be positive.");`
- Do not throw `Exception` or `SystemException` directly. Do not catch `Exception` unless you rethrow, translate, or add context and then rethrow. Preserve the original exception as the inner exception: `throw new InvalidOperationException("Failed to load config.", ex);`
- Use `try`/`finally` (or `using`) to release resources deterministically.
- Do not use exceptions for expected control flow; return a status, `bool`, or a `Result` type instead. Guard public entry points with `ArgumentNullException.ThrowIfNull(args)` where the target framework allows it. Do not leak sensitive information in exception messages.

## Testing
- Frameworks: xUnit (most common), NUnit, and MSTest are all supported; MSTest is the Visual Studio default.
- Layout: a separate test project mirroring the production namespaces; `MyProduct.Tests/Configuration/ConfigLoaderTests.cs`.
- Test class: `<TypeUnderTest>Tests` (plural) or `<TypeUnderTest>Test`; be consistent with the project. Test method: PascalCase, a sentence describing the behaviour - `Load_ThrowsArgumentNullException_WhenPathIsNull`.
- Use `[Fact]` / `[Theory]` with `[InlineData]` for table-driven cases under xUnit. Follow Arrange / Act / Assert, with a blank line between the phases and a single assert focus per test.
- Use the theory/parameterised form for the same behaviour with different inputs instead of copy-pasted tests. Use a fixture for shared setup; keep fixtures immutable and reset state between tests.
- Prefer `Assert.Throws<T>` and assert on the message when the message is part of the contract. Mock only external boundaries; prefer fakes for value objects.

## Anti-Patterns
- `strName`, `iCount`, `m_value` - instead use `name`, `count`, `value`; no Hungarian notation.
- `Get_Name` or `get_name` - instead `GetName` / `getName`; no underscores. `public int Length;` - instead expose `public int Length { get; }`; do not publish fields.
- `public bool CantSeek { get; }` - instead `CanSeek`.
- `catch (Exception ex) { }` - instead catch the specific type and rethrow with context.
- `throw new Exception("failed")` - instead throw `InvalidOperationException` with a specific message.
- `ToLong` / `ToFloat` - instead `ToInt64` / `ToSingle`; use CLR type names.
- A property named `GetWindow` - instead name the property `Window`. A `Before`/`After` event pair - instead use the present/past tense pair `Closing`/`Closed`.
- `int i = 0; for (...) { ... }` with a shadowed loop variable - instead use `foreach` and a named variable.

## Code Example
```csharp
using System;
using System.Collections.Generic;
using System.IO;

namespace MyCompany.MyProduct.Configuration
{
    /// <summary>
    /// Reads service configuration from a simple key=value file.
    /// </summary>
    public sealed class ConfigLoader
    {
        private const string NameKey = "name";
        private const string DefaultName = "unnamed-service";
        private readonly string path;

        /// <summary>
        /// Initializes a new instance of the <see cref="ConfigLoader"/> class.
        /// </summary>
        public ConfigLoader(string path)
        {
            this.path = path ?? throw new ArgumentNullException(nameof(path));
        }

        public IReadOnlyDictionary<string, string> Load()
        {
            var values = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (string line in File.ReadAllLines(path))
            {
                int separator = line.IndexOf('=');
                if (separator > 0)
                {
                    values[line.Substring(0, separator).Trim()] = line.Substring(separator + 1).Trim();
                }
            }
            return values;
        }
    }
}
```

## Sources
- https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/naming-guidelines
- https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/capitalization-conventions
- https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/general-naming-conventions
- https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/names-of-type-members
- https://learn.microsoft.com/en-us/dotnet/standard/security/secure-coding-guidelines
