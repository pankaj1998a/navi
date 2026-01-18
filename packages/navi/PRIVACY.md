# Navi Privacy and Data Policy

## Overview
Navi is designed to be privacy-first. **No data is sent to external servers by default.**

## Telemetry (Disabled by Default)

### Default Behavior
- Telemetry is **OFF** by default
- Default target is `LOCAL` (writes to local files only)
- No data is sent to Google Cloud or any external service

### Enabling Telemetry (Opt-In)
To enable telemetry, you must explicitly set:
```bash
export GEMINI_TELEMETRY_ENABLED=true
export GEMINI_TELEMETRY_TARGET=gcp  # Only if you want GCP Cloud
```

### What Telemetry Collects (When Enabled)
- Tool call metrics
- API response times
- Token usage statistics
- Error logs (sanitized)

### What Telemetry Does NOT Collect
- Your code content
- Prompt content (unless `GEMINI_TELEMETRY_LOG_PROMPTS=true`)
- Personal identifiable information
- File contents

## Auto-Share (Disabled by Default)

The `NAVI_AUTO_SHARE` feature is **disabled by default**.
To enable session sharing, set:
```bash
export NAVI_AUTO_SHARE=true
```

## Data Storage
All data is stored locally:
- Config: `~/.navi/` or `NAVI_CONFIG_DIR`
- Sessions: Local SQLite database
- Telemetry: Local files or configured OTLP endpoint

## External Connections
Navi only connects to external services when:
1. **AI Model API** - Your configured provider (Gemini, Anthropic, etc.)
2. **MCP Servers** - Explicitly configured MCP servers
3. **Telemetry** - Only if explicitly enabled

## No navi Servers
Navi does **NOT** send any data to navi.dev or navi.io servers.
All navi references have been renamed to navi.

## Verification
Run this command to verify no external connections:
```bash
# Check for external URLs in config
grep -r "navi" ~/.navi/
```
