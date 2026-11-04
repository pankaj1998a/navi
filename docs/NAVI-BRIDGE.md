# NaviBridge: Zero-API-Key Web AI Bridge & Local Workspace Engine

> **Turn your logged-in browser AI accounts (ChatGPT Plus, Claude Pro, Gemini Advanced, DeepSeek) into an automated, zero-cost AI engine directly inside the Navi CLI.**

---

## 1. What is NaviBridge?

Traditional AI coding tools require expensive paid API keys and monthly token consumption bills. **NaviBridge** connects Navi directly to your active, logged-in browser sessions via a lightweight local Rust daemon and a Chrome extension.

- **Zero API Keys & $0 Token Cost:** Leverage your existing ChatGPT, Claude, DeepSeek, or Gemini web accounts.
- **Device-Isolated & Private:** Binds strictly to `127.0.0.1:10086`. No cloud telemetry or third-party servers. All secrets are stored in `~/.navi/bridge.token`.
- **Ultra-Low Memory Footprint:** The background daemon is built in Rust using Tokio and consumes only **~4 MB to 8 MB of RAM**.
- **99% CLI-First:** Run everything straight from your terminal (`navi ask`, `navi run --model bridge/claude`). You never have to switch to Chrome to copy-paste.

---

## 2. Quick Setup (One-Time)

### Step 1: Initialize NaviBridge on your device
Run the automated device setup command:
```bash
navi bridge install
```
This automatically:
1. Generates and stores your secure local device token in `~/.navi/bridge.token`.
2. Unpacks the companion extension into `~/.navi/extension`.
3. Auto-starts the background Rust daemon.

### Step 2: Load the Extension in Chrome
1. In Google Chrome, navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the folder:
   ```
   ~/.navi/extension
   ```
4. Click the NaviBridge extension icon in your browser toolbar to confirm **Link CLI** is checked.

### Step 3: Verify with Doctor
```bash
navi bridge doctor
```
Output:
```
✓ NaviBridge Daemon: Online (http://127.0.0.1:10086)
✓ Chrome Extension: Connected (1 active link)
  Ready to serve CLI queries via `navi ask` or `--model bridge/<provider>`
```

---

## 3. Daily Terminal Usage (99% CLI Workflow)

### A. Instant Terminal Queries (`navi ask`)
Ask any browser AI directly without leaving your shell:
```bash
# Query Claude
navi ask "Explain this error: segmentation fault (core dumped)" --provider claude

# Query DeepSeek R1 (reasoning mode)
navi ask "Write an async Tokio TCP listener in Rust" --provider deepseek

# Query ChatGPT
navi ask "What are the trade-offs of microservices vs monolith?" --provider chatgpt
```

### B. Multi-Model Consensus (Fan-Out)
Query multiple models simultaneously to compare answers and catch hallucinations:
```bash
navi ask "Which library is best for WebSockets in Rust?" --providers chatgpt,claude,deepseek
```

### C. Agentic Coding in Navi (`navi run`)
Run full autonomous agent tasks using your browser AI as the model provider:
```bash
# Run Navi agent using Claude 3.7 Sonnet from your browser
navi run "Audit this codebase for memory leaks and add tests" --model bridge/claude

# Run with DeepSeek
navi run "Implement user authentication with JWT" --model bridge/deepseek
```

---

## 4. How File Editing Works: Two Solutions

Because web AI chats only return text and markdown, Navi provides **two complementary solutions** so that models can read, edit, and change files in your project.

```
┌────────────────────────────────────────────────────────────────────────┐
│                       SOLUTION COMPARISON                              │
│                                                                        │
│  Solution 1 (Web-Inward):                                              │
│    Claude.ai / ChatGPT Web ──[ MCP Tunnel ]──> Navi Local Workspace    │
│    (You chat inside the browser, web AI calls local edit/bash tools)   │
│                                                                        │
│  Solution 2 (Terminal-Outward):                                        │
│    Navi CLI ──> Web AI plans ──> Navi Rust Patcher applies to files    │
│    (You chat inside terminal, files are modified automatically)        │
└────────────────────────────────────────────────────────────────────────┘
```

---

### Solution 1: Remote MCP Web Connectors (`navi bridge tunnel`)
*Best if you prefer chatting inside the Claude.ai or ChatGPT web interface while giving the model access to your local files.*

1. Run the tunnel command from your project directory:
   ```bash
   navi bridge tunnel
   ```
2. Navi spins up an SSE MCP server on port `4040` and exposes a secure Cloudflare tunnel.
3. Configure your web model:
   - **Claude.ai:** Go to *Settings → Customize → Connectors → Add Custom Web Connector*. Enter the provided SSE URL and Bearer token.
   - **ChatGPT:** Enable *Developer Mode* in Settings → *MCP Connectors* → Add custom connector with the URL and token.
4. The web AI can now autonomously call:
   - `read_file`
   - `edit_file`
   - `write_file`
   - `apply_patch`
   - `bash_command`

---

### Solution 2: Automated File Patching (Brain + Hands Relay)
*Best for 99% CLI users who work completely in the terminal.*

In this workflow, the Web AI acts as the **Architect / Brain** (reasoning and planning), and Navi acts as the **Hands / Executor** (surgically modifying files).

#### Deterministic Patching with `--apply` (`-a`)
When asking a web AI to write or fix code, pass the `--apply` flag:
```bash
navi ask "Refactor src/auth.rs to use SHA-256 constant-time comparison" --provider claude --apply
```
1. Claude produces the code modifications.
2. Navi's patch engine automatically detects and extracts code blocks, unified diffs, or patch hunks.
3. Navi pipes the diff directly into `navi-native apply-patch` and applies changes to your workspace in milliseconds.

#### Interactive Confirmation
If you run without `--apply`, Navi previews the touched files:
```
⚡ Detected 2 code change(s) for 2 file(s):
   • src/auth.rs
   • src/main.rs
Tip: Run with `--apply` (or `-a`) to automatically apply these changes to your files.
```

---

## 5. CLI Command Reference

| Command | Description |
|---|---|
| `navi bridge status` | Check if local Rust daemon is running. |
| `navi bridge start` | Explicitly start the background Rust daemon. |
| `navi bridge doctor` | Probe active Chrome tabs and verify extension link. |
| `navi bridge token` | Display local auth token and secret path (`~/.navi/bridge.token`). |
| `navi bridge install` | Unpack extension and initialize device configuration. |
| `navi bridge tunnel` | Launch workspace MCP tunnel for Claude.ai / ChatGPT web connectors. |
| `navi ask "<prompt>"` | Query a web AI model directly from terminal (`-p provider`). |
| `navi ask "<prompt>" -a` | Query web AI and **automatically apply code diffs** to files. |

---

## 6. Troubleshooting

- **Extension shows "Disconnected":**
  1. Verify the daemon is running with `navi bridge status`.
  2. If offline, run `navi bridge start`.
  3. Ensure **Link CLI** is checked in the extension popup.
- **Provider not logged in:**
  1. Open Chrome and make sure you are signed in to the provider (e.g. `claude.ai` or `chatgpt.com`).
  2. Keep at least one tab of that provider open (can be minimized).
  3. Run `navi bridge doctor` to confirm Navi detects the active tab.
