# Java Style Guide

> Source: Google Java Style Guide (https://google.github.io/styleguide/javaguide.html), the most widely used Java convention set. The Oracle Code Conventions link in the awesome list is historical (Java 1.0 era) and is not used here.

## Quick Rules
- Indent with 2 spaces. Never use tabs.
- Limit lines to 100 characters.
- Use K&R braces: no line break before the opening brace, line break after it and before the closing brace.
- `UpperCamelCase` for classes and types, `lowerCamelCase` for methods, variables, parameters, and fields, `UPPER_SNAKE_CASE` for true constants.
- No wildcard imports - neither `import java.util.*` nor static wildcard imports.
- Declare local variables close to first use, not in a block of declarations at the top.
- Always annotate an overriding method with `@Override` when it is legal.
- Every `switch` must be exhaustive - include a `default` label even if it is empty.
- Never swallow a caught exception silently; log it, rethrow it, or explain in a comment why it is safe to ignore.
- Use `// TODO: <issue-link> - <explanation>.` with a bug reference. Javadoc on every public class, method, and field; start with a summary fragment, not "This method returns...".

## Formatting
- Indentation: 2 spaces per block level. Continuation lines: at least +4 spaces.
- Column limit: 100 characters. Exceptions: package declarations, import statements, long URLs in Javadoc, text block contents.
- Braces: K&R for non-empty blocks. Empty blocks may be `{}` but not inside a multi-block statement such as `if/else` or `try/catch`.
- One statement per line. No horizontal alignment of declarations; do not pad field names to line up types.
- Import order: all static imports in one group, then all non-static imports in one group, separated by one blank line; within each group sort by ASCII order of the imported name.
- Source file order: license, package declaration, imports, exactly one top-level class. One blank line between sections.
- File name equals the top-level class name plus `.java`. UTF-8 encoding; ASCII horizontal space only. No trailing whitespace.
- Modifiers in JLS order: `public protected private abstract default static final sealed non-sealed transient volatile synchronized native strictfp`.
- `long` literals use an uppercase `L` suffix (`3000000000L`). Overloads of the same method stay together as a contiguous group.

## Naming
- Package: lowercase letters and digits only, words concatenated: `com.example.deepspace`.
- Class: `UpperCamelCase`, noun or noun phrase - `ImmutableList`, `Character`. Interface: `UpperCamelCase` - `List`, `Readable`.
- Test class: name of the class under test plus `Test` - `HashImplTest`.
- Method: `lowerCamelCase`, verb or verb phrase - `sendMessage`, `stop`. Test method: `lowerCamelCase` with an underscore separating the case, e.g. `transferMoney_deductsFromSource`.
- Constant: `UPPER_SNAKE_CASE`. A constant is a `static final` field that is deeply immutable; a mutable collection is not a constant.
- Non-constant field: `lowerCamelCase`, noun phrase - `computedValues`, `index`. Local variables: `lowerCamelCase`, even when `final`.
- Parameter: `lowerCamelCase`; avoid one-character names in public methods. Type variable: a single capital letter plus optional numeral (`E`, `T`, `X`, `T2`).
- No Hungarian-style prefixes or suffixes: not `name_`, `mName`, `s_name`, `kName`.
- Acronyms are treated as words: `XmlHttpRequest`, `newCustomerId`, `supportsIpv6OnIos`.

## Types and Data
- Use `final` for local variables and fields that are not reassigned; prefer immutable value objects.
- Return concrete collection types (`List`, `Map`, `Set`) rather than raw `Collection` or `Map`. Prefer `List.of(...)` / `Map.of(...)`.
- Use `Optional` for a return value that may be absent, not as a field or parameter type. Prefer `Objects.equals(a, b)` over `a == b` when either side may be null.
- Do not use `null` to mean "not found" in a collection lookup; use `containsKey` / `containsValue` or `Optional`.
- Generic type parameters use meaningful names when the meaning matters: `class Cache<K, V>`.
- Prefer `record` for immutable data carriers; give components a doc comment. Enum constants are `UPPER_SNAKE_CASE`; give them a constructor with fields when the enum carries data.

## Comments and Documentation
- Javadoc style: `/** ... */` for multi-line, `/** Short summary. */` for a single line, or Markdown Javadoc with `///`.
- Javadoc starts with a summary fragment (noun or verb phrase), capitalised and punctuated as a sentence, but not a full sentence beginning "A `Foo` is...".
- Block tags appear in the order `@param`, `@return`, `@throws`, `@deprecated`, and never with an empty description.
- Traditional Javadoc: paragraphs separated by a blank ` *` line, continuation lines of block tags indented 4+ spaces. Markdown Javadoc: indent continuation lines exactly 2 spaces.
- Implementation comments use `//`; multi-line `/* ... */` blocks put `*` at the start of continuation lines. Comments explain *why*, not *what*.
- TODO format: `// TODO: crbug.com/12345678 - Remove this after the 2047q4 window expires.` Avoid TODOs that name a person as the context.

## Error Handling
- Throw a specific checked or unchecked exception that fits the failure; prefer the most specific standard type.
- Never catch `Exception` or `Throwable` unless you rethrow or translate it. Do not catch and silently swallow, and do not use `printStackTrace()`; use a logger.
- Use `finally` (or try-with-resources) for cleanup that must run on every path.
- Validate arguments at the public boundary and throw `IllegalArgumentException` naming the offending value.
- Prefer returning `Optional` or `null` only when the caller cannot act on the failure.

## Testing
- Frameworks: JUnit 5 (Jupiter) is the default; JUnit 4 for legacy code; AssertJ and Mockito are common additions.
- Layout: tests live in the same package under `src/test/java`, mirroring the production package structure.
- Test class name: `<ClassUnderTest>Test`. Test method name: `<method>_<expectedBehaviour>`, e.g. `transferMoney_deductsFromSource`.
- Annotate with `@Test`; use `@ParameterizedTest` with `@ValueSource`/`@CsvSource` for table-driven cases, and `@Nested` to group related cases.
- Structure each test as Arrange / Act / Assert with a blank line between the phases.
- Assert on observable behaviour and on specific values; do not assert on incidental implementation details.
- Use `@BeforeEach`/`@AfterEach` for setup and teardown; prefer constructor injection over field injection.
- Mock only at boundaries you do not own (network, clock, file system); prefer fakes for value objects. Never test private methods directly.

## Anti-Patterns
- `import java.util.*;` - instead list the exact classes you use.
- `public class Foo` where `public` is the default - instead omit it.
- A block of `int a; int b; String c;` declared at the top of every method - instead declare each variable next to its first use.
- `if (x != null) { ... } else { ... }` after an early return - instead return early and drop the `else`.
- `catch (Exception e) { }` - instead catch the specific exception and log or rethrow.
- `if (list.size() == 0)` - instead use `list.isEmpty()`.
- `String s = ""; if (x != null) s = x.toString();` - instead use `String.valueOf(x)`.
- `setValue`/`getValue` when a plain field or a `record` component expresses the same thing - instead prefer the simpler construct.

## Code Example
```java
package com.example.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

/** Reads service configuration from a simple {@code key=value} file. */
public final class ConfigLoader {

  private static final String NAME_KEY = "name";
  private static final String DEFAULT_NAME = "unnamed-service";

  private final Path path;

  public ConfigLoader(Path path) {
    this.path = path;
  }

  /**
   * Loads the configuration file.
   *
   * @return the parsed key/value pairs
   * @throws IOException if the file cannot be read
   */
  public Map<String, String> load() throws IOException {
    Map<String, String> values = new HashMap<>();
    for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
      int separator = line.indexOf('=');
      if (separator > 0) {
        values.put(line.substring(0, separator).trim(), line.substring(separator + 1).trim());
      }
    }
    values.putIfAbsent(NAME_KEY, DEFAULT_NAME);
    return values;
  }
}
```

## Sources
- https://google.github.io/styleguide/javaguide.html
- https://docs.oracle.com/javase/specs/jls/se21/html/jls-1.html
- https://junit.org/junit5/docs/current/user-guide/
