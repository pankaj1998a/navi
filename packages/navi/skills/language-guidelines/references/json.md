# JSON Style Guide

> Source: Google JSON Style Guide (https://google.github.io/styleguide/jsoncguide.html, revision 0.9). The URL listed in the awesome list (`jsoncstyleguide.xml`) returns 404; the guide now lives at the URL above. Formatting rules below (indentation, no trailing commas) follow the Google guide and standard JSON tooling practice.

## Quick Rules
- Use double quotes for every property name and every string value. Never use single quotes, and never leave a name unquoted.
- Property names must be `lowerCamelCase` ASCII strings that are valid JavaScript identifiers, so clients can use dot notation: `"thisPropertyIsAnIdentifier"`.
- No comments in JSON. JSON has no comment syntax, and no parser is required to accept them.
- No trailing commas anywhere. A trailing comma makes the document invalid JSON.
- Property values may only be booleans, numbers, Unicode strings, objects, arrays, or `null`. Never a bare identifier or a function body.
- Array-valued properties get plural names; everything else is singular. Prefer `itemCount` over `totalItem`.
- Represent enum values as strings (`"color": "WHITE"`), so clients survive enum changes.
- Format dates as RFC 3339 strings, durations as ISO 8601, coordinates as ISO 6709.
- Drop `null` and empty properties unless their absence would be ambiguous.
- Indent with 2 spaces and keep one property per line for machine-generated files.

## Formatting
- Indentation: 2 spaces per nesting level. Use 4 only if the surrounding project already does.
- One property per line for any object that is read by humans or by a diff. Compact single-line objects are acceptable only for tiny maps.
- No trailing comma after the last member of an object or the last element of an array.
- Use a space after the colon, and no space before it: `"name": "value"`.
- Use a space after every comma.
- Strings use standard JSON escapes (`\"`, `\\`, `\n`, `\t`, `\uXXXX`). Keep non-ASCII characters as literal UTF-8 rather than escaping them, unless the file must be pure ASCII.
- Files are UTF-8 encoded. End the file with a newline and no trailing whitespace.
- Keep the top-level object flat and free of generated metadata noise; the document should be diffable.
- For a large machine-generated file, keep keys in a deterministic (sorted) order so diffs stay small.

## Naming
- Property names: `lowerCamelCase`; first character is a letter, `_`, or `$`; subsequent characters may be letters, digits, `_`, or `$`.
- Avoid reserved JavaScript words as property names (`class`, `default`, `function`, `new`, `var`) - they cannot be reached with dot notation.
- Do not use underscores or dashes in property names.
- Maps (objects used as free-form key/value stores) may use any Unicode key; document in the API description that the object is a map, not a fixed schema.
- Singular for scalars and objects, plural for arrays. Qualify a count with a noun: `itemCount`, `totalItems`.
- Reserved top-level names when building an API: `apiVersion`, `context`, `id`, `method`, `params`, `data`, `error`.
- Reserved names inside `data`: `kind`, `fields`, `etag`, `id`, `lang`, `updated`, `deleted`, `items`, plus the paging fields `currentItemCount`, `itemsPerPage`, `startIndex`, `totalItems`, `pageIndex`, `totalPages`.
- Reserved names inside `error`: `code`, `message`, `errors` (an array of `domain`, `reason`, `message`, `location`, `locationType`, `extendedHelp`, `sendReport`).

## Types and Data
- Allowed value types: `true`/`false`, numbers, strings, objects, arrays, `null`. Nothing else.
- Booleans are `true`/`false`, never `"true"`/`"false"`.
- Numbers are unquoted. Use an integer literal for integers; do not write `1.0` for a count.
- Prefer omitting an optional property over emitting `"field": null`. Keep `null` when the value is meaningful and its absence would be read as "not set".
- Keep `0` and `false` in the payload when they carry meaning - do not treat them as empty.
- Flatten data structures unless a nested object genuinely represents one entity. A nested `address` object is better than `addressLine1`/`addressLine2` siblings.
- Enum values are strings so that clients can handle values they do not know.
- Timestamps: RFC 3339, e.g. `"lastUpdate": "2007-11-06T16:34:41.000Z"`.
- Durations: ISO 8601, e.g. `"duration": "P3Y6M4DT12H30M5S"`.
- Coordinates: ISO 6709 plus/minus degrees, e.g. `"+40.6894-074.0447"`.
- Language tags: BCP 47, e.g. `"lang": "en"`.

## Comments and Documentation
- JSON carries no comments. Put explanations in a sibling README, a schema document, or a `$comment`-style extension only if the consumer is known to ignore unknown keys.
- Document the meaning of each property in the API documentation rather than inline.
- If a JSON file is generated, record the generator and its version in a header field such as `"generatedBy"`, not in a comment.
- Do not use `"//"`-style keys as pseudo-comments; they are indistinguishable from real data.

## Error Handling
- Report failures with a top-level `error` object, never by returning a partially populated `data` object.
- A response contains either `data` or `error`, never both. If both are present, `error` wins.
- `error.code` is an integer, normally the HTTP status code.
- `error.message` is a human-readable sentence describing the first error.
- `error.errors` is an array for multiple failures; each entry has `domain` (the service raising it), `reason` (a stable machine-readable identifier), `message`, and optionally `location`, `locationType`, `extendedHelp`, `sendReport`.
- Use `reason` for programmatic branching (`"ResourceNotFoundException"`) and `message` for humans. Never make clients parse `message`.
- Do not leak internal stack traces, file paths, or SQL in an error payload.

## Testing
- Validate every generated document against its schema (JSON Schema, or a typed model) in CI.
- Round-trip test: parse a fixture and assert the resulting object matches the expected value, rather than comparing JSON text.
- When comparing JSON text, normalise key order first, or compare parsed structures, so ordering does not create false failures.
- Keep small golden files per endpoint and regenerate them intentionally when the contract changes.
- Test the failure path too: an error response must still be a valid document matching the error schema.
- Keep fixtures in `test/fixtures` or `__fixtures__` and load them relative to the test file, not the process working directory.

## Anti-Patterns
- `{'name': 'value'}` - instead use double quotes; single-quoted JSON is not JSON.
- `{"a": 1, "b": 2,}` - instead remove the trailing comma.
- `// a comment` inside a JSON file - instead move the comment to the documentation.
- `{"count": "5"}` - instead write `"count": 5`; a quoted number is a string.
- `{"isActive": "true"}` - instead write `"isActive": true`.
- `{"url": url}` (an unquoted identifier) - instead write the actual string value.
- `{"data": null, "error": {...}}` - instead return only the `error` object.
- Deeply nesting for no semantic reason (`{"a": {"b": {"c": ...}}}`) - instead flatten unless each level is a real entity.

## Code Example
```json
{
  "apiVersion": "2.1",
  "id": "request-42",
  "data": {
    "kind": "album",
    "title": "My Photo Album",
    "updated": "2010-02-04T19:29:54.001Z",
    "itemCount": 2,
    "itemsPerPage": 10,
    "startIndex": 1,
    "totalItems": 2,
    "items": [
      {
        "id": "BGODurRfVv4",
        "kind": "photo",
        "title": "My First Photo",
        "uploaded": "2009-11-17T20:10:06.000Z",
        "duration": 315,
        "tags": [
          "surf",
          "dog"
        ],
        "thumbnail": {
          "default": "https://i.ytimg.com/vi/BGODurRfVv4/default.jpg",
          "hqDefault": "https://i.ytimg.com/vi/BGODurRfVv4/hqdefault.jpg"
        }
      }
    ]
  }
}
```

## Sources
- https://google.github.io/styleguide/jsoncguide.html
- https://www.json.org/
- https://datatracker.ietf.org/doc/html/rfc3339
- https://datatracker.ietf.org/doc/html/rfc7159
