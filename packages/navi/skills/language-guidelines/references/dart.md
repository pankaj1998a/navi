# Dart Style Guide

> Source: Effective Dart (https://dart.dev/effective-dart) plus the Dart style guide page at https://dart.dev/effective-dart/style and the package layout conventions at https://dart.dev/tools/pub/package-layout

## Quick Rules

- Format code with `dart format`; never hand-tune whitespace that the formatter owns.
- Use `UpperCamelCase` for types and extensions, `lowerCamelCase` for everything else, `lowercase_with_underscores` for files, directories, and packages.
- Prefer `final` over `var` for variables that are never reassigned.
- Use `var` only when the type is obvious from the initializer.
- Use `{}` for all flow-control statements, even single-statement bodies.
- Put `dart:` imports first, then `package:` imports, then relative imports; sort each group alphabetically.
- Prefer non-nullable types; use `?` only when absence is a legitimate state.
- Never explicitly initialize a variable or parameter to `null`.
- Use `///` doc comments for public API; write the summary as a complete sentence.
- Prefer `throw`ing `Error` subclasses for programming errors and `Exception` for recoverable failures.

## Formatting

- Indentation: 4 spaces (this is what `dart format` produces); spaces only.
- Line length: 80 characters or fewer where practical.
- Braces: always use curly braces for `if`, `for`, `while`, `try`, and function bodies.
- One statement per line; one declaration per line.
- Trailing commas force the formatter to break argument lists one-per-line - use them for long calls.
- File structure: `lib/` for public code, `bin/` for executables, `test/` for tests, `tool/` for developer tools.
- A library's public API lives directly in `lib/`; internal code goes in `lib/src/` and is never imported by other packages.
- Use relative imports within a package; use `package:` imports across packages.
- No trailing whitespace; files end with a newline.

## Naming

- Types, classes, enums, mixins, extensions, typedefs: `UpperCamelCase`.
- Functions, methods, getters, setters, parameters, locals: `lowerCamelCase`.
- Files and directories: `lowercase_with_underscores` (`user_profile.dart`, `user_profile_test.dart`).
- Package names: `lowercase_with_underscores`.
- Constants: `lowerCamelCase` (Dart has no special constant convention), e.g. `maxRetries`.
- Booleans: prefer positive, assertion-style names: `isValid`, `hasChildren`, `shouldRetry`.
- Private members are prefixed with `_`; library-private by convention, enforced by the analyzer.
- Test files: `<subject>_test.dart`; test groups: `group('...', () { ... })`.
- Acronyms longer than two letters are capitalized like words (`HttpClient`, not `HTTPClient`); two-letter acronyms stay uppercase (`IO`).

## Types and Data

- Use `final` for locals and fields that are assigned once; use `late` only when initialization is genuinely deferred.
- Prefer `final` fields for read-only properties instead of a getter wrapping a private field.
- Use `required` on non-nullable named parameters that must be supplied.
- Use `const` constructors for immutable classes; use `const` literals for constant collections.
- Use collection expressions (`[1, 2, 3]`, `{1, 2, 3}`) for collection literals.
- Use `sealed`, `base`, `interface`, and `final` class modifiers to control how types can be extended or implemented.
- Avoid `dynamic`; annotate with the real type instead.
- Use records or classes rather than positional tuples of unclear meaning.
- Avoid `dynamic` and `Object?` catch-alls; prefer precise types.

## Comments and Documentation

- Use `///` doc comments for public members, types, and library-level documentation.
- Start a doc comment with a one-sentence summary, then a blank `///` line before details.
- Write comments as complete sentences, capitalized, ending with a period.
- Refer to identifiers in square brackets: `[List]`; use backticks for code fragments.
- Document `Parameters` and `Returns` in prose for anything non-obvious.
- Use `//` for short inline explanations; avoid `/* */` blocks for documentation.
- Prefer `///` over `//` for anything a user of the API will read.

## Error Handling

- Implement `Error` for programming errors (a caller violated the contract) and `Exception` for recoverable runtime failures.
- Never catch `Error` or `Exception` without an `on` clause unless you rethrow.
- Use `rethrow` to rethrow a caught exception and preserve the stack trace.
- Do not discard errors from a catch block silently.
- Prefer `Result`-style returns or `Future.error` over exceptions for expected failures.
- Validate arguments at the public boundary with `ArgumentError`; do not validate inside the core algorithm.
- Use `assert` for invariants that should never be violated (stripped in release builds).

## Testing

- Put tests in `test/` mirroring the `lib/` layout: `test/user_profile_test.dart` for `lib/user_profile.dart`.
- Use the `test` package: `group`, `test`, `setUp`, `tearDown`.
- Name test cases as sentences describing behaviour: `test('returns the display name for a user', ...)`.
- Use `expect(actual, expected)` with the expected value second; add a `reason:` when the failure is not obvious.
- Prefer `setUp`/`tearDown` over repeating fixture code in each test.
- Use mocks (`mockito`, `mocktail`) only for dependencies you do not own.
- Keep one behaviour per `test` block so failures point at a single cause.

## Anti-Patterns

- `String s = null;`. Instead: use a non-nullable type, or `String? s;`.
- `if (x == true)`. Instead: `if (x)`.
- `list.length == 0`. Instead: `list.isEmpty`.
- A getter and setter wrapping every field. Instead: use a `final` field.
- `dynamic` parameters. Instead: declare the concrete type.
- `try { ... } catch (e) { }`. Instead: catch a specific type with an `on` clause and handle it.
- Public code in `lib/src/` imported from other packages. Instead: move it to `lib/` and export it.
- One-letter variable names outside of short loops. Instead: use descriptive names.

## Code Example

```dart
/// A user of the system.
///
/// Instances of this class are immutable; all fields are final.
class User {
  /// The name shown to other users.
  final String displayName;

  /// The unique, stable identifier of this user.
  final String id;

  /// Whether the user is allowed to sign in.
  final bool isActive;

  /// Creates a user. The [id] must not be empty.
  User({
    required this.displayName,
    required this.id,
    this.isActive = true,
  }) {
    if (id.isEmpty) {
      throw ArgumentError.value(id, 'id', 'must not be empty');
    }
  }

  /// Returns a copy of this user with a different display name.
  User copyWith({String? displayName}) {
    return User(
      displayName: displayName ?? this.displayName,
      id: id,
      isActive: isActive,
    );
  }
  @override
  String toString() => 'User($id, $displayName)';
}
```

## Sources

- https://dart.dev/effective-dart
- https://dart.dev/effective-dart/style
- https://dart.dev/effective-dart/documentation
- https://dart.dev/tools/pub/package-layout
