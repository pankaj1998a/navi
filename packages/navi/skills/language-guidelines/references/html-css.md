# HTML/CSS Style Guide

> Source: Google HTML/CSS Style Guide (https://google.github.io/styleguide/htmlcssguide.html)

## Quick Rules

- Use 2-space indentation, no tabs.
- Use only lowercase for all HTML element names, attributes, attribute values (unless text), CSS selectors, properties, and property values.
- Remove trailing whitespace.
- Use UTF-8 without BOM (`<meta charset="utf-8">`).
- Use HTML5 doctype: `<!DOCTYPE html>`.
- Omit protocol from embedded resource URLs (`//example.com/style.css`) or use relative/HTTPS links.
- Omit `type` attributes for style sheets (`<link rel="stylesheet" href="...">`) and scripts (`<script src="...">`).
- Use meaningful, semantic ID and class names; avoid presentational names like `red-button` or `left-column`.
- ID and class names must use lowercase alphanumeric characters and hyphens (`-`). Never use camelCase or underscores.
- Use CSS shorthand properties where possible (`margin: 1em 0;`).
- Omit unit specifications after `0` values (`margin: 0;`, not `0px`).
- Include a space after property colons, before opening curly braces, and end every CSS declaration with a semicolon.

## Formatting

### HTML
- Indent nested elements by 2 spaces.
- Do not indent `<html>`, `<head>`, or `<body>` (optional according to Google, but keep 2-space indent consistent).
- Use double quotes (`"`) rather than single quotes for attribute values.
- Put every block, list, or table element on a new line, and put every child element on a new line.
- Boolean attributes do not need values: `<input type="checkbox" checked>` instead of `checked="checked"`.

### CSS
- Put declarations in alphabetical order (e.g. `background`, `border`, `color`, `display`, `font`, `margin`).
- Separate selector and `{` with a single space.
- Put every declaration on its own line for maintainability.
- Put closing brace `}` on a new line.
- Separate rule sets by one blank line.
- Always quote attribute values in selectors (`input[type="text"]`).
- Avoid qualifying class and ID selectors with tag names (`.nav`, not `ul.nav`).

## Naming

- Class names: lowercase with hyphens (`site-header`, `user-profile-card`).
- ID names: lowercase with hyphens (`main-nav`, `search-form`). Use IDs sparingly.
- Custom properties / CSS variables: lowercase with hyphens (`--primary-color`, `--spacing-unit`).
- Keep names as short as possible while remaining clear and semantic (`author-bio`, not `author-biography-text-area`).

## Anti-Patterns

- Uppercase tags or attributes (`<DIV>`, `HREF`). Instead: lowercase (`<div>`, `href`).
- Inline `style="..."` attributes. Instead: separate CSS rule sets.
- Presentational naming (`.bold-red-text`). Instead: semantic purpose (`.error-message`).
- Underscores or camelCase in selectors (`.user_card`, `.userCard`). Instead: hyphens (`.user-card`).
- Specifying units for zero (`padding: 0px`). Instead: `padding: 0`.
- Missing semicolons at the end of property declarations. Instead: always terminate with `;`.

## Code Example

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>User Profile</title>
    <link rel="stylesheet" href="style.css">
  </head>
  <body>
    <header class="site-header">
      <h1 class="page-title">Profile Summary</h1>
    </header>
    <main class="content-container">
      <article class="user-card">
        <h2 class="user-name">Jane Doe</h2>
        <p class="user-role">Software Engineer</p>
      </article>
    </main>
  </body>
</html>
```

```css
.site-header {
  border-bottom: 1px solid #e0e0e0;
  margin: 0 0 16px;
  padding: 8px 16px;
}

.user-card {
  background-color: #ffffff;
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  padding: 16px;
}

.user-name {
  color: #1a1a1a;
  font-size: 1.5rem;
  margin: 0 0 4px;
}
```

## Sources
- https://google.github.io/styleguide/htmlcssguide.html
