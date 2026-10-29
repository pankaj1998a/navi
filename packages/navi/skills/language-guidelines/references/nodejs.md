# Node.js Style Guide

> Source: Microsoft + Node.js Guidelines (https://github.com/Microsoft/nodejs-guidelines) plus Felix's Node.js Style Guide (https://github.com/felixge/node-style-guide) and Node.js API docs (https://nodejs.org/api/esm.html)

## Quick Rules
- Use 2 spaces for indentation, never tabs, and never mix the two.
- Use semicolons; use UNIX (`\n`) line endings and end every file with a newline.
- Use single quotes, except when the string itself contains a single quote.
- Use `===` and `!==`; the only tolerated `==` is `x == null` when both `null` and `undefined` must match.
- Callback convention: the first parameter of a callback is always the error object, and it must be handled.
- Declare one variable per statement, and prefer `const` over `let`; never use `var` in new code.
- Name variables and functions in camelCase, classes in PascalCase, constants in UPPER_SNAKE_CASE.
- Keep lines at 80 characters and remove all trailing whitespace.
- Never use `with`, `eval`, or `new Function()`; do not extend built-in prototypes.
- Do not use setters; side-effect-free getters are acceptable.

## Formatting
- Indentation: 2 spaces per level, consistent across the whole tree.
- Braces: opening brace on the same line as the statement; `else` on the same line as the closing brace.
- Line length: 80 characters max; wrap long calls and conditions.
- No trailing whitespace at end of lines; files end with a single newline character.
- One `var`/`const`/`let` declaration per statement, never chained with commas.
- Object literals: `{ key: 'value' }` with a space after the colon and after each comma.
- Use an `.editorconfig` file to enforce indentation, newline style, and trailing-whitespace behaviour.

## Naming
- Functions and variables: camelCase (`getUserById`).
- Classes and constructors: PascalCase (`UserRepository`).
- Constants and module-level immutable values: UPPER_SNAKE_CASE (`MAX_RETRIES`).
- File names: lowercase, hyphenated or camelCase, matching the module's exported name (`user-repository.js`).
- Error classes end with `Error` (`ValidationError`); events are lowercase past-tense verbs (`userCreated`).
- Avoid abbreviations and Hungarian notation (`sName` is banned; use `name`).

## Structure
- Entry point in `app.js` (or `index.js`), with the package manifest in `package.json` at the repository root.
- Keep `node_modules` out of version control; commit the lock file (`package-lock.json`, `npm-shrinkwrap.json`).
- Separate concerns into modules: `lib/` for logic, `routes/` or `controllers/` for HTTP handling, `config/` for settings.
- Read configuration and secrets from environment variables (`process.env.PORT`), never hard-code them.
- Use `node:` prefixed imports for built-ins (`node:fs`, `node:path`) so the intent is explicit.
- In ES modules, always include the file extension in relative import specifiers (`./addTwo.js`).

## Tooling
- Declare the supported runtime with `engines.node` in `package.json` and pin the major version.
- Scripts in `package.json` for the common tasks: `start`, `test`, `lint`, `format`.
- Use `nodemon` (or `node --watch`) for local development restarts.
- Lint with ESLint; enforce the Node and JavaScript Standard Style rules.
- Test with the built-in `node:test` runner or an established framework; keep tests in `test/`.
- Run `npm ci` in CI so the lock file is used exactly as committed.
- Publish with `npm publish`; use `npm pack --dry-run` to inspect the tarball contents first.

## Anti-Patterns
- Ignoring the error parameter in a callback. Instead: `if (err) return callback(err);` on the first line.
- Swallowing errors in an empty `catch` block. Instead: log with context and rethrow or return a typed error.
- Installing packages globally with `npm install -g`. Instead: declare them in `package.json` and install locally.
- Using `var`, or declaring several variables in one statement. Instead: one `const`/`let` per statement.
- Depending on a platform-specific path or shell assumption. Instead: use `path.join`, `path.sep`, and cross-platform APIs.
- Blocking the event loop with synchronous file or network calls. Instead: use the async API or `worker_threads`.
- Committing `node_modules` or a `.env` file. Instead: gitignore them and provide `.env.example`.

## Code/Config Example
```js
// lib/user-repository.js
'use strict';

const { readFile } = require('node:fs/promises');

const MAX_RETRIES = 3;

/**
 * Loads a user by id.
 * @param {string} id
 * @param {(err: Error|null, user?: object) => void} callback
 */
function loadUser(id, callback) {
  readFile(`users/${id}.json`, 'utf8')
    .then((raw) => callback(null, JSON.parse(raw)))
    .catch((err) => callback(err));
}

module.exports = { loadUser, MAX_RETRIES };
```

## Sources
- https://github.com/Microsoft/nodejs-guidelines
- https://github.com/felixge/node-style-guide
- https://nodejs.org/api/esm.html
- https://nodejs.org/api/errors.html
