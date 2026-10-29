# JavaScript Style Guide

> Source: Google JavaScript Style Guide (https://google.github.io/styleguide/jsguide.html). Google has frozen this guide and recommends the TypeScript guide for new code; the rules below are still the most commonly cited JavaScript conventions. `eslint` and `clang-format` are the usual enforcers.

## Quick Rules
- Indent with 2 spaces. Never use tabs.
- Limit lines to 80 characters.
- Every statement ends with a semicolon. Never rely on automatic semicolon insertion.
- Use `const` by default; use `let` only when the binding is reassigned; never use `var`.
- Use single quotes for strings; use template literals only when interpolation or multi-line text is needed.
- Declare variables close to first use, and initialise at declaration.
- Use named exports; do not use default exports.
- Use `const` arrow functions assigned to a variable; use `function` declarations for hoisted top-level functions.
- Use `===` and `!==`; only use `==` when the coercion is deliberate and documented.
- Every control structure needs braces, even for a single statement. Document every exported function and class with JSDoc.

## Formatting
- Indentation: 2 spaces per block level. Continuation lines: at least +4 spaces.
- Column limit: 80 characters. Exceptions: `import`/`export from` statements, long URLs, long string literals meant to be searchable.
- Braces: K&R for non-empty blocks - no line break before `{`, line break after it, line break before `}`. Braces are required on all control structures; a one-line `if` without `else` is the only exception allowed.
- One statement per line. Every statement terminated with `;`. No trailing whitespace.
- UTF-8 encoding; ASCII space is the only whitespace outside literals and comments.
- Import order: ES module `import` statements at the top, then `goog.require`/`goog.requireType` blocks, then implementation. No blank lines inside a require block. Import paths must include the `.js` extension.
- Object and array literals may be formatted "block-like" with one element per line and a trailing comma. Do not horizontally align properties or arguments.

## Naming
- File names: all lowercase, may include `_` or `-`, extension `.js`.
- Constants: `CONSTANT_NAME` in `UPPER_SNAKE_CASE`.
- Class names: `UpperCamelCase`. Method and function names: `lowerCamelCase` verbs - `getName()`, `setName()`.
- Non-constant field/property names: `lowerCamelCase` nouns. Local variables: `lowerCamelCase`.
- Parameters: `lowerCamelCase`; use `_` for a deliberately unused parameter.
- Module-local names that must not be exported: prefix with `_` or keep them out of the export list.
- Module namespace import: `import * as fileOne from './file-one.js';`. Named imports keep the exported name; alias only to disambiguate (`import {Cat as BigCat}`).
- Acronyms are words: `userId`, `parseUrl`, not `userID` / `parseURL`.

## Types and Data
- Use `const` by default; `let` only for reassignment; never `var` (it is function-scoped and hoisted). Declare and initialise in one statement: `const items = loadItems();`. One variable per declaration.
- Prefer `const` objects and `Object.freeze` for immutable configuration maps, and immutable array methods - `map`, `filter`, `reduce`, `slice`, `concat` - over mutating shared state.
- Use `Map` and `Set` rather than plain objects as dictionary keys, and `Array.from(...)` or spread rather than `Array.prototype.slice.call(arguments)`.
- For optional data, return `null`/`undefined` consistently and document which one; prefer `undefined` for "absent". Use optional chaining (`?.`) and nullish coalescing (`??`) rather than manual guards.

## Comments and Documentation
- Javadoc style: `/** ... */` blocks before the declaration, with `@param`, `@return`, `@throws` tags where useful.
- A file-level `@fileoverview` comment goes at the top, before imports. The description starts with a capital letter and ends with a period.
- JSDoc type annotations use Closure syntax: `@param {string} name`, `@return {number}`.
- Implementation comments use `//`; block comments `/* ... */` for multi-line notes. Comments explain *why*, not *what*.
- TODO format: `// TODO(owner): description` or `// TODO(b/12345678): description`. Do not leave commented-out code in a file.

## Error Handling
- `throw` a `TypeError` for a wrong type and a `RangeError` for an invalid value; use `Error` otherwise. Always attach a message.
- Catch at the boundary that can actually handle or translate the error, not in every layer.
- Re-throw with context: `catch (err) { throw new Error('Failed to fetch user', {cause: err}); }`.
- Never swallow an error with an empty `catch` block; if you must, add a comment explaining why it is safe.
- Do not use exceptions for ordinary control flow; return a result object or `null` instead.
- For promise chains, always attach a rejection handler; an unhandled rejection is a bug. Validate untrusted input at the edge.

## Testing
- Frameworks: Jest is the most common; Mocha + Chai, Vitest, and Jasmine are also widely used. Node's built-in `node:test` runner is a reasonable zero-dependency choice.
- Layout: `*.test.js` next to the source, or a top-level `test/`/`__tests__/` directory. Match the project's existing convention.
- Test file name mirrors the unit under test: `configLoader.test.js` for `configLoader.js`. Test/describe names read as sentences: `describe('ConfigLoader', ...)` and `it('throws when the file is missing', ...)`.
- Use `beforeEach`/`afterEach` for setup and teardown; keep the arrange/act/assert structure visible.
- Assert on behaviour through the public API, not on internal state. Prefer real objects over mocks; mock only boundaries you do not control. Use fake timers (`jest.useFakeTimers()`) for time-dependent code instead of sleeping.

## Anti-Patterns
- `var x = 1;` - instead `const x = 1;` (or `let` when reassigned).
- `if (x == 1)` - instead `if (x === 1)`; reserve `==` for deliberate coercion.
- Relying on automatic semicolon insertion - instead write the semicolon explicitly.
- `if (cond) doThing();` without braces - instead always use braces.
- `import _ from './thing';` - instead use named exports so imports are greppable and rename-safe.
- `const arr = new Array(5);` - instead use a literal or `Array.from({length: 5})`.
- `for (var i in obj)` - instead `Object.keys(obj)` or `Object.entries(obj)`.
- A bare `catch (e) {}` - instead log or rethrow with context.

## Code Example
```javascript
/**
 * Loads and validates service configuration.
 * @module configLoader
 */

import {readFile} from 'node:fs/promises';

/** Default name used when the configuration omits one. */
const DEFAULT_NAME = 'unnamed-service';

/**
 * Parses a `key=value` configuration document.
 *
 * @param {string} contents Raw configuration text.
 * @return {!Object<string, string>} Parsed key/value pairs.
 */
export function parseConfig(contents) {
  const values = {};
  for (const line of contents.split('\n')) {
    const separator = line.indexOf('=');
    if (separator > 0) {
      values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }
  return values;
}

/**
 * Reads a configuration file from disk.
 *
 * @param {string} path Absolute path to the configuration file.
 * @return {!Promise<!Object<string, string>>} Parsed configuration.
 * @throws {Error} If the file cannot be read.
 */
export async function loadConfig(path) {
  let contents;
  try {
    contents = await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read config at ${path}`, {cause: err});
  }
  const values = parseConfig(contents);
  return {...values, name: values.name || DEFAULT_NAME};
}
```

## Sources
- https://google.github.io/styleguide/jsguide.html
- https://github.com/airbnb/javascript
- https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Writing_style_guide/Code_style_guide/JavaScript
