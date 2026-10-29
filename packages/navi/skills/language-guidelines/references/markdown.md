# Markdown Style Guide

> Source: Google Markdown Style Guide (https://github.com/google/styleguide/blob/gh-pages/docguide/style.md), also published at https://google.github.io/styleguide/docguide/style.md. The awesome list also links the Ciro Santilli Markdown Style Guide (http://www.cirosantilli.com/markdown-style-guide/) and the GitLab Markdown Style Guide (https://about.gitlab.com/handbook/markdown-guide/); the Google guide is the primary source used here.

## Quick Rules
- Use ATX-style headings (`# Heading`), never Setext underlines (`===` / `---`).
- Use exactly one level-1 heading per document, as the page title. Everything else is H2 or deeper.
- Put a blank line before and after every heading.
- Keep lines at 80 characters or fewer. The main exceptions are links, tables, headings, and code blocks.
- Never leave trailing whitespace. Use a trailing backslash (`\`) if you need a hard line break.
- Use fenced code blocks with an explicit language tag for every code sample: ` ```go `, ` ```shell `, ` ```json `.
- Use fenced code blocks, not four-space-indented ones.
- Prefer standard Markdown over raw HTML.
- Write informative link text; never "here" or "link".
- Use 4-space indentation for nested list content. Use one sentence per line in long prose documents so diffs stay small.

## Formatting
- Line limit: 80 characters. Tables, links, headings, and code blocks may exceed it.
- Blank line separates every block: headings, paragraphs, lists, tables, and code blocks.
- A document typically starts with `# Title`, then a 1-3 sentence introduction, then an optional `[TOC]`, then `##` sections.
- Lists: use `-` for bullets. Indent nested list content by 4 spaces, and use 4 spaces for each level of nesting.
- Use lazy numbering (`1.` for every item) for long lists that may change; use explicit `1. 2. 3.` for short, stable lists.
- Fenced code blocks always declare the language. Use `shell` for command lines and end shell snippets with a trailing backslash so they can be pasted.
- Inline code uses backticks: `README.md`, `foo_bar_whammy`.
- Reference links are useful for long URLs and for keeping table cells short; define them at the end of the section where they are first used.
- No HTML hacks, no `<br>` for layout, no `<div>` wrappers.
- Images: use sparingly, always with descriptive alt text.

## Naming
- Headings are unique and fully descriptive, even for sub-sections: prefer `### Foo summary` over `### Summary` under a `## Foo` heading. Duplicate headings produce ambiguous anchor links.
- Heading capitalization follows sentence case for prose docs, or the project's title case convention; be consistent within a document.
- File names: lowercase with hyphens, matching the title - `markdown-style-guide.md`. `README.md` and `CHANGELOG.md` keep their conventional uppercase.
- Product and tool names keep their official capitalisation: `Markdown`, `GitHub`, `GitLab`, `Python`.
- Link text describes the destination: `[Markdown style guide](style.md)`, not `[here](style.md)`.
- Anchor-friendly wording: avoid punctuation-only headings such as `## What?`; use `## Overview`.

## Types and Data
- Not applicable in the usual sense. The equivalent concerns are:
- Document structure: one H1, a logical H2/H3 hierarchy, no skipped levels (do not jump from H2 to H4).
- Front matter: if the platform supports YAML front matter, keep it minimal and stable (`title`, `description`).
- Lists: use a list when the items are a genuine enumeration; use a table when the data is genuinely tabular and the reader will scan across columns.
- Admonitions: prefer a plain bold lead-in (`**Note:**`) over a platform-specific admonition syntax, so the document stays portable.
- Links: prefer absolute or root-relative paths (`/docs/page.md`) over `../` relative paths, which break when a file moves.

## Comments and Documentation
- Markdown has no comment syntax for authors. HTML comments (`<!-- ... -->`) are possible but discouraged; they leak into rendered output on some platforms.
- Document the intent of a section with its heading and the first sentence after it. A reader should understand the section's purpose without reading the body.
- Do not leave "TODO" or "FIXME" text in a published document. Track outstanding work in the issue tracker instead.
- Do not reference a line number in a comment; reference a heading or a function name, which is stable.
- When documenting code, the code itself carries the inline documentation; the Markdown explains how to use it.

## Error Handling
- There is no error handling in Markdown, but broken links and broken structure are the equivalent failures.
- Always verify that relative links resolve and that the referenced file or anchor exists.
- Prefer a link to a heading anchor over a link to a bare URL, and make sure the anchor matches the heading text exactly.
- When a document is moved, update the links that point at it rather than leaving a redirect.
- Keep a `## See also` section at the bottom of a long page for related links, so a reader who did not find what they needed has somewhere to go.
- If a section is a placeholder, mark it explicitly with `**TODO:**` rather than shipping an empty heading that reads like an oversight.

## Testing
- Lint with `markdownlint` (or `markdownlint-cli2`) in CI; the rule set commonly enabled is MD001 (heading increment), MD003 (heading style), MD009 (trailing spaces), MD012 (multiple blank lines), MD022 (blanks around headings), MD031 (blanks around fences), MD040 (fenced code language), MD041 (first line is a top-level heading), MD047 (file ends with a newline).
- Check that all fenced blocks declare a language tag.
- Verify all links resolve, including in-page anchors, using a link checker.
- Check that the document has exactly one H1 and no skipped heading levels.
- Preview the rendered output for the target platform; GitHub, GitLab, and MkDocs differ in table and footnote support.
- If the document is generated, verify the generator's output in the same CI job as the source templates.

## Anti-Patterns
- Setext headings (`Title` followed by `=====`) - instead use `# Title`.
- Multiple H1 headings in one file - instead keep one H1 and demote the rest to H2.
- `##Heading` with no space after the hashes - instead `## Heading`.
- An indented four-space code block - instead use a fenced block with a language tag.
- A fence with no language tag - instead tag it so the highlighter and the reader both know what it is.
- Two trailing spaces at the end of a line for a line break - instead use a trailing backslash, or restructure into separate paragraphs.
- Link text "here" or "click here" - instead use descriptive text: `[the Markdown style guide](style.md)`.
- Raw HTML for a table or a break - instead use Markdown syntax.

## Code Example
````markdown
# Configuration Reference

This page lists the keys accepted in a service configuration file. Every key is
optional unless marked **required**.

[TOC]

## File format

A configuration file is a list of `key=value` lines. Blank lines and lines
starting with `#` are ignored.

```text
name=my-service
retries=3
```

## Keys

- `name` - the service name used in logs. Defaults to `unnamed-service`.
- `retries` - the number of retries for a failed request. Must be a positive
  integer.

### retries

The `retries` key controls how many times a failed request is retried. The
value must parse as a positive integer; anything else is rejected at startup.

```shell
my-service --config config.ini --retries 3 \
  --verbose
```

## See also

- [Command-line options](cli.md)
- [Deployment guide](deploy.md)
````

## Sources
- https://github.com/google/styleguide/blob/gh-pages/docguide/style.md
- https://google.github.io/styleguide/docguide/style.md
- http://www.cirosantilli.com/markdown-style-guide/
- https://about.gitlab.com/handbook/markdown-guide/
- https://github.com/DavidAnson/markdownlint
