# PRD Workflow Guide

Navi includes Ralph-inspired autonomous PRD-driven development.

## Quick Start

```bash
# 1. Create a PRD from requirements
> Use create_prd skill for "Add user authentication with OAuth"

# 2. Run autonomous loop
> Run autonomous_loop agent
```

## Workflow

```
┌─────────────────┐
│ Create PRD      │  User describes feature
└────────┬────────┘
         ▼
┌─────────────────┐
│ prd.json        │  Structured stories with priorities
└────────┬────────┘
         ▼
┌─────────────────┐
│ Autonomous Loop │  Iterates until all pass
└────────┬────────┘
         ▼
┌─────────────────┐
│ progress.txt    │  Learnings for future iterations
└─────────────────┘
```

## PRD Structure

```json
{
  "name": "Feature Name",
  "stories": [
    {
      "id": "story-1",
      "title": "Add login endpoint",
      "priority": 1,
      "status": "pending",
      "passes": false
    }
  ]
}
```

## Story States

| Status | Description |
|--------|-------------|
| `pending` | Not started |
| `in_progress` | Currently working |
| `passed` | Completed successfully |
| `failed` | Has errors |
| `skipped` | Intentionally skipped |

## Best Practices

1. **Small stories** - Each should fit in one context window
2. **Clear acceptance criteria** - Define what "done" means
3. **Dependencies** - Mark stories that depend on others
4. **Priority** - Lower number = higher priority
