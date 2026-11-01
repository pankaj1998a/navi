# Native Muse Plugin Contract

This reference summarizes the manifest accepted by the current Muse validator.
The Plugin Creator instructions remain authoritative for reservation, mutation,
validation order, correction limits, and reporting.

## Package Layout

A native plugin is a new directory in the current workspace. Its manifest is:

```text
.muse-plugin/plugin.json
```

Every file named by a capability is relative to the plugin root. A minimal manifest
contains:

```json
{
  "schemaVersion": 1,
  "name": "example-plugin",
  "displayName": "Example Plugin",
  "version": "0.1.0",
  "description": "One plain-language sentence.",
  "compat": {
    "source": "native",
    "manifestDir": ".muse-plugin"
  },
  "capabilities": {
    "skills": [],
    "commands": [],
    "hooks": [],
    "mcpServers": [],
    "reminders": []
  }
}
```

Use only fields required by the request. The installed validator decides whether an
omitted optional field is acceptable.

## Identifiers

Plugin and capability IDs use this portable grammar:

```text
^[a-z0-9][a-z0-9._-]{0,79}$
```

The basename before the first dot must not case-fold to `CON`, `PRN`, `AUX`, `NUL`,
`COM1` through `COM9`, or `LPT1` through `LPT9`. Plugin IDs `loop` and `muse-core`
are reserved by the product bundle.

## Paths

- Use relative UTF-8 paths and `/` separators in the manifest.
- Reject absolute paths, parent traversal, backslashes, and blank paths.
- Create every referenced file before validation.
- Canonicalize containment; a symlink must not escape the plugin or workspace root.
- Keep generated component names portable across macOS, Linux, and Windows.

## Capability Fields

### Skills

```json
{"id":"review","path":"