on{
  "schemaVersion": 1,
  "supportedFamilies": [
    "skills",
    "commands",
    "hooks",
    "mcpServers",
    "reminders"
  ],
  "unsupportedFamilies": [
    "tools",
    "agents",
    "outputStyles",
    "settings",
    "apps"
  ],
  "reservedPluginIds": [
    "loop",
    "muse-core",
    "memory-reminder",
    "skill-reminder",
    "todo-reminder",
    "goal-reminder",
    "verify-reminder",
    "scope-reminder",
    "herdr",
    "threejs",
    "tbh-reminders"
  ],
  "creatorContract": {
    "idRules": {
      "maxBytes": 80,
      "pattern": "^[a-z0-9][a-z0-9._-]{0,79}$",
      "windowsReservedBasenames": [
        "CON",
        "PRN",
        "AUX",
        "NUL",
        "COM1",
        "COM2",
        "COM3",
        "COM4",
        "COM5",
        "COM6",
        "COM7",
        "COM8",
        "COM9",
        "LPT1",
        "LPT2",
        "LPT3",
        "LPT4",
        "LPT5",
        "LPT6",
        "LPT7",
        "LPT8",
        "LPT9"
      ],
      "rejectedExamples": [
        "",
        "Uppercase",
        "con",
        "CON.txt",
        "lpt1.log",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      ]
    },
    "pathRules": {
      "relativeOnly": true,
      "separator": "/",
      "reject": [
        "absolute",
        "parent-traversal",
        "backslash",
        "symlink-escape",
        "outside-workspace"
      ]
    },
    "destination": {
      "mustBeAbsent": true,
      "atomicNoReplace": true,
      "recheckCanonicalContainment": true
    },
    "validation": {
      "order": [
        "nestedSkills",
        "plugin"
      ],
      "success": {
        "exitCode": 0,
        "valid": true,
        "diagnostics": []
      },
      "warningsAccepted": false,
      "maxCorrectionRounds": 3,
      "terminalFailedResult": 4
    },
    "installProposal": {
      "program": "muse",
      "argv": [
        "plugins",
        "install",
        "<canonical-plugin-path>"
      ],
      "executed": false
    },
    "forbiddenActions": [
      "install",
      "enable",
      "trust",
      "execute",
      "fetch"
    ]
  },
  "examples": [
    {
      "family": "skills",
      "manifest": {
        "schemaVersion": 1,
        "name": "skills-example",
        "displayName": "Skills Example",
        "version": "0.1.0",
        "description": "One native skill capability.",
        "compat": {
          "source": "native",
          "manifestDir": ".muse-plugin"
        },
        "capabilities": {
          "skills": [
            {
              "id": "review",
              "path": "