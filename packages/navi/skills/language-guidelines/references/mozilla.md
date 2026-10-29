# Mozilla Style Guide

> Source: Mozilla Coding Style Guide on MDN (https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Writing_style_guide/Code_style_guide) plus the JavaScript, CSS, and HTML sub-guides

## Quick Rules
- Code examples must be runnable and production-worthy: readers copy and paste them into their own code.
- Use Prettier as the formatter; do not hand-tune whitespace, indentation, or line breaks.
- Use modern features only once all major browsers support them (Baseline); otherwise feature-detect and provide a fallback.
- Declare variables with `const` by default and `let` when reassignment is needed; never use `var` in new examples.
- Use strict equality (`===`, `!==`); the only acceptable loose comparison is `x == null`.
- Use `camelCase` for functions, variables, and object properties; `PascalCase` for classes.
- Always use braces for control-flow bodies, even for a single statement.
- Use single-line `//` comments that state intent, not a restatement of the code.
- Never insert untrusted text with `innerHTML`; use `textContent`.
- Do not use deprecated APIs, browser prefixes, or `document.write()`.

## Formatting
- Indentation: 2 spaces, enforced by Prettier; never mix tabs and spaces.
- Use the `example-good` / `example-bad` info string after the language tag to mark good and bad samples.
- Always tag code blocks with the correct language; use `plain` for pseudocode, output, and stack traces.
- Keep code blocks to roughly 15-25 lines; link to a full example in a repo for anything longer.
- Use template literals for string interpolation instead of concatenation.
- Break long lines at natural boundaries; prefer a template literal over a chain of `+` operators.
- Set the rendered example width to 100% and keep its height under 700px.

## Naming
- Functions: `camelCase`, lowercase first letter, concise and semantic (`sayHello`, not `doIt`).
- Classes: `PascalCase`; instances and object literals: `camelCase`.
- Variables: `camelCase`, 3-10 characters, real-world semantics; no Hungarian notation (`sName`).
- Collections: plural by content (`cars`, not `carArray`).
- Method names in prose always carry parentheses: `doSomethingUseful()`.
- Inline code markup for identifiers: the `frenchText()` function.

## Structure
- One example per documented feature; strip unrelated server-side code, frameworks, and preprocessors.
- Wrap callback work in `try...catch` and only catch recoverable errors; let the rest bubble up.
- Place comments on the line above the code they describe, separated by a blank line when not at the same indent level.
- Use `//` for comments; reserve `/* ... */` for eliding parameters and for the ellipsis marker.
- Put the ellipsis inside a comment (`// ...`) so the sample stays valid JavaScript.
- Use `for...of` or `forEach()` for collection iteration; reserve `for (;;)` for index-based loops.
- Use `Object.hasOwn()` rather than `hasOwnProperty()`.

## Tooling
- Prettier is the single source of formatting truth; commit its config file (`.prettierrc.json`) with the project.
- ESLint runs over the content repository for the rules Prettier does not cover.
- Use `console.log()` for informational output and `console.error()` for errors in samples.
- Use `@supports not (...)` to show a fallback message for unsupported CSS features.
- Keep the live-sample iframe at 100% width and below 700px height so the result is legible on mobile.
- Use the standard lorem ipsum placeholder text so spell checkers do not flag it.

## Anti-Patterns
- `innerHTML` to insert text. Instead: `element.textContent = text;`.
- `document.write()` and deprecated APIs such as `XMLHttpRequest`. Instead: `fetch()` and modern APIs.
- `var` declarations and multiple declarations in one statement. Instead: one `const`/`let` per line.
- Loose equality (`==`). Instead: `===`, or `== null` when both nullish values must match.
- `for...in` over arrays and strings. Instead: `for...of`, `forEach()`, or `map()`/`filter()`.
- Comments that narrate the code line by line. Instead: state the intent or drop the comment.
- Browser prefixes such as `webkitAudioContext`. Instead: use the standard API with a feature check.

## Code/Config Example
```js
class Person {
  #name;
  #birthYear;

  constructor(name, year) {
    this.#name = String(name);
    this.#birthYear = Number(year);
  }

  greeting() {
    // Use the private fields rather than exposing them on the instance
    console.log(`Hi! I'm ${this.#name}`);
  }
}

const luke = new Person("Luke Skywalker", 25);
luke.greeting();
```

## Sources
- https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Writing_style_guide/Code_style_guide
- https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Code_style_guide/JavaScript
- https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Code_style_guide/CSS
- https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Code_style_guide/HTML
- https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Code_style_guide/Shell
