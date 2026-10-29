---
name: headroom
description: "Context compression and lossless CCR (Compress-Cache-Retrieve) layer for AI agents. Compresses large tool outputs, terminal logs, git diffs, JSON payloads, and source code skeletons by 60-90% while preserving critical errors and stack traces."
---

# Headroom AI Context Compression & Lossless CCR (`navi headroom`)

Headroom optimizes context window usage across LLM conversations by compressing verbose tool outputs, logs, diffs, and structured payloads **before** they reach the LLM, while stashing the uncompressed original in a content-addressed CCR store.

## How It Works

```
 Tool Output / Build Log / Diff (10,000+ lines)
                │
                ▼
     ┌────────────────────────────────────────────────────┐
     │  Headroom Native Compression Engine (Rust FFI)     │
     │  - Log Compressor (extracts errors, stack traces) │
     │  - Diff Compressor (trims unchanged context)      │
     │  - JSON Crusher (strips nulls, empty structures)  │
     │  - Code Skeleton (preserves signatures/exports)   │
     └────────────────────────────────────────────────────┘
                │
                ├────────────────────────────────────────┐
                ▼                                        ▼
   Compressed Prompt (~75% tokens saved)       Original Payload Stashed
      + CCR Marker: `<<ccr:5a2b1c...>>`         in CCR Memory Store
                │                                        │
                ▼                                        │
   LLM Reads Compressed Context                          │
   (If it needs full verbatim text)                      │
                │                                        │
                ▼                                        ▼
   Calls `headroom_retrieve(key)` ───────────────────────┘
```

## CLI Commands

```bash
# View global compression statistics and tokens saved
navi headroom stats

# Run offline benchmark suite on sample logs, diffs, and JSON
navi headroom test

# Compress a file or tool output directly
navi headroom compress <filepath> -t [log|diff|json|code]

# Retrieve the full uncompressed text for a CCR marker key
navi headroom retrieve <ccr_key>

# Start drop-in HTTP reverse proxy for OpenAI and Anthropic clients
navi headroom proxy --port 8787 [--upstream <url>]

# Start Model Context Protocol (MCP) server over stdio for Cursor/Cline
navi headroom mcp
```

## Drop-In Reverse Proxy Mode

The Headroom proxy intercepts outbound LLM requests, compresses bulky tool results and conversation context on the fly, and streams the upstream response back with `X-Headroom-Tokens-Saved` telemetry:

```bash
# In your terminal:
navi headroom proxy --port 8787

# Use with any OpenAI-compatible tool:
export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"

# Use with any Anthropic-compatible tool:
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
```

## Model Context Protocol (MCP) Server

Connect Navi's Headroom context engine to external IDEs (Cursor, Claude Desktop, Antigravity IDE, Cline):

```json
{
  "mcpServers": {
    "navi-headroom": {
      "command": "bun",
      "args": ["run", "v:/pankaj/navi/packages/navi/src/index.ts", "headroom", "mcp"]
    }
  }
}
```

Exposes standard tools:
- `headroom_compress`: Auto-detects and compresses logs, diffs, JSON, and code skeletons into CCR markers.
- `headroom_retrieve`: Retrieves the original lossless text using the 24-char hash key.
- `headroom_stats`: Returns live telemetry on saved tokens and active cache entries.

## Agent Best Practices

- When inspecting tool outputs with `<<ccr:key>>`, the critical errors, line numbers, and failure summaries are **already present** in the compressed view.
- If and only if exact verbatim bytecode or full unabridged source is required, invoke the `headroom_retrieve` tool with the provided key to fetch the original content without losing fidelity.

