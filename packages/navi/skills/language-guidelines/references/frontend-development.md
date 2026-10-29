# Frontend Development Style Guide

> Source: CSS Guidelines (https://cssguidelin.es), Frontend Guidelines (https://github.com/bendc/frontend-guidelines), Sass Guidelines (https://sass-guidelin.es) and BEM (https://getbem.com)

## Quick Rules
- Indent with 2 spaces, no tabs; keep lines near 80 characters.
- Use semantic HTML5 elements (`main`, `article`, `header`, `nav`, `time`) instead of `div` soup.
- Always quote attributes; use lowercase element names; always set `lang` on `<html>` and `<meta charset="utf-8">`.
- Use classes for styling, never IDs; keep selectors short and never nest more than one level deep in a preprocessor.
- Name with a hyphenated, BEM-like scheme: `.block`, `.block__element`, `.block--modifier`.
- Separate behaviour hooks from styles with a `js-` prefixed class; use `data-*` for data, not for JS binding.
- Treat the semicolon as a terminator in CSS, always; keep the last declaration semicolon-terminated.
- Prefer modern CSS: Flexbox/Grid over absolute positioning, `rem` over `px`, transitions over animations, `opacity`/`transform` as the only animated properties.
- Meet WCAG 2.1 AA: alt text, labelled form controls, visible focus, 4.5:1 text contrast.
- Minimize dependencies: third-party code is code you did not write and must maintain.

## Formatting
- CSS: one declaration per line, `{` on the same line as the last selector, `}` on its own line, space after `:`.
- HTML: one element per line for block structure; no closing tags for void elements; omit optional end tags only where the parent is unambiguous.
- Sass: `@charset 'utf-8';` first in the main stylesheet; single-quoted strings; leading zeros on fractions; no unit on zero lengths.
- Sass ruleset order: local variables, mixin calls without `@content`, declarations, nested selectors, mixin calls with `@content`.
- Use shorthand properties and canonical order (`border: 1px solid red`, not `border: solid red 1px`).
- Use `rgba()`/`rgb()` (modern syntax) for transparency; lowercase hex is acceptable.

## Naming
- Classes: hyphen-delimited, BEM-like -- `.site-nav`, `.site-nav__item`, `.site-nav--active`.
- Never use camelCase or snake_case in class names (`.pageHead` and `.sub_content` are both wrong).
- BEM blocks start at the most self-contained context: `.room` and `.person` are separate blocks, not `.room__person`.
- JavaScript hooks: `js-` prefix (`class="btn js-btn"`); keep them separate from the styling class.
- Sass variables, functions, and mixins: lowercase hyphen-delimited and meaningful (`$vertical-rhythm-baseline`).
- Sass constants: ALL_CAPS (`$CSS_POSITIONS`); namespace distributed code (`$su-configuration`).
- Prefix IDs only for JavaScript targets or page anchors, never for styling.

## Structure
- Split CSS into multiple files (settings, tools, generic, base, objects, components, trumps) and keep a table-of-contents comment at the top of the master file.
- Mark major sections with a banner comment so they can be found with `grep`.
- Use one blank line between closely related rulesets, two between loosely related, five between sections.
- Place the element-specific code in the block's own file; link partials across files with object-extension pointer comments.
- Keep the box model uniform: `* { box-sizing: border-box; }` globally, and never re-declare it per element.
- Keep markup in natural document flow; only use `position: absolute` when there is no alternative.

## Tooling
- Format and lint CSS with Stylelint; lint HTML with `html-validate`; lint JS with ESLint.
- Use a CSS preprocessor only when the project already does; otherwise write plain CSS.
- Serve and bundle with the framework's tooling (Vite, webpack) and check the result in Lighthouse.
- Run an accessibility audit (axe, Lighthouse) on every pull request; target WCAG 2.1 AA.
- Validate HTML with the W3C Nu validator and CSS with the W3C CSS validator.
- Use EditorConfig to share indentation and newline rules across the team.

## Anti-Patterns
- `!important` to win a specificity fight. Instead: lower the specificity of the original rule and re-order it.
- ID selectors and deeply qualified selectors like `div:first-of-type :last-child > p ~ *`. Instead: add a class.
- `transition: all`. Instead: transition the specific properties you actually change.
- Animating `margin-left` or `width`. Instead: animate `transform` and `opacity` only.
- Absolute positioning to replace normal flow. Instead: use flexbox/grid or margins.
- Styling with inline `style` attributes. Instead: move the rule into the stylesheet.
- `data-*` attributes used as JS event hooks. Instead: use a `js-` class.
- Pulling in a whole library for two utility functions. Instead: write the five lines or use the platform.

## Code/Config Example
```html
<main class="page">
  <article class="post">
    <header class="post__header">
      <h1 class="post__title">Blog post</h1>
      <p class="post__meta">
        Published: <time datetime="2015-02-21">21st Feb, 2015</time>
      </p>
    </header>
  </article>
</main>
```

```css
.page {
  max-width: 60rem;
  margin: 0 auto;
}

.post__title {
  font-size: 2rem;
}

.post--highlight {
  border-left: 4px solid #5a3;
}
```

## Sources
- https://cssguidelin.es
- https://github.com/bendc/frontend-guidelines
- https://sass-guidelin.es
- https://getbem.com
- https://www.w3.org/TR/WCAG21/
- https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Code_style_guide/CSS
