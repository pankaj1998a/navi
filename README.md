<p align="center">
  <img src="docs/logo.png" alt="Navi logo" width="200">
</p>
<h1 align="center">Navi</h1>
<p align="center">The open-source AI coding IDE & CLI with parallel agent execution.</p>
<p align="center">
  <a href="#installation"><strong>Installation</strong></a> •
  <a href="#features"><strong>Features</strong></a> •
  <a href="#parallel-agents"><strong>Parallel Agents</strong></a> •
  <a href="#documentation"><strong>Docs</strong></a>
</p>

---

## 🚀 What is Navi?

Navi is a next-generation AI coding assistant that combines the best features from leading AI coding tools:

- **navi** - Base architecture, TUI framework, provider-agnostic design
- **Claude Code** - Tool use patterns, file editing, terminal integration
- **Gemini CLI** - Google Search grounding, checkpointing, custom commands
- **Cline** - Browser automation (Computer Use), checkpoint restore
- **Continue** - Cloud agents, IDE integration, Mission Control
- **Amazon Q CLI / Kiro** - High-performance terminal patterns
- **Qwen Code** - Plan mode, SubAgents system

### Key Differentiators

| Feature | Navi | Others |
|---------|------|--------|
| **Parallel Agent Execution** | ✅ Run multiple agents simultaneously | ❌ Sequential only |
| **Provider Agnostic** | ✅ Claude, OpenAI, Gemini, local models | Varies |
| **Browser Automation** | ✅ Click, type, scroll, screenshot | Some |
| **Cloud Agents** | ✅ Background tasks, PR reviews | Some |
| **Desktop + CLI + TUI** | ✅ All three interfaces | Varies |

---

## Installation

### Quick Install (NPM)

```bash
# Install globally via NPM
npm install -g navi-ai-agent

# Or with bun/pnpm/yarn
bun add -g navi-ai-agent
pnpm add -g navi-ai-agent
yarn global add navi-ai-agent
```

### One-Click Installation (From Source)

If you have cloned the repository, you can use the automated installer:

#### Windows
Run this in PowerShell:
```powershell
.\install.ps1
```

#### macOS / Linux
Run this in your terminal:
```bash
chmod +x install.sh && ./install.sh
```

### 🔄 Update & Uninstall

#### Update to latest version
```powershell
# Windows
.\update.ps1

# Mac/Linux
./update.sh
```

#### Uninstall Navi
```powershell
# Windows
.\uninstall.ps1

# Mac/Linux
./uninstall.sh
```

### Manual Installation (From Source)

If you want to run the latest version directly from GitHub:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/pankaj/navi.git
   cd navi
   ```

2. **Install dependencies** (requires [Bun](https://bun.sh)):
   ```bash
   bun install
   ```

3. **Link the command globally**:
   ```bash
   cd packages/navi
   bun link
   ```

*Now you can run `navi` from any directory on your system!*

### Windows One-Click Setup

If you are on Windows, you can also use the included batch wrapper:

1. Add the `navi` root folder to your **User PATH** environment variable.
2. Restart your terminal.
3. Type `navi` to start.

### Environment Setup

Create a `.env` file or set environment variables:

```bash
# Required: Set your AI provider API key
export GEMINI_API_KEY="your-api-key"
# OR
export ANTHROPIC_API_KEY="your-api-key"
# OR
export OPENAI_API_KEY="your-api-key"
```

### Desktop App

Download from the [releases page](https://github.com/pankaj/navi/releases):

| Platform | Download |
|----------|----------|
| Windows | `navi-desktop-windows-x64.exe` |
| macOS (Apple Silicon) | `navi-desktop-darwin-aarch64.dmg` |
| macOS (Intel) | `navi-desktop-darwin-x64.dmg` |
| Linux | `.deb`, `.rpm`, or AppImage |

---

## Features

### 🤖 Parallel Agent Execution

Run multiple specialized agents simultaneously:

```bash
# Launch multiple agents in parallel
> @code Fix the authentication bug
> @docs Update the README  
> @test Write unit tests for the new feature

# All three agents work concurrently!
```

### 🧠 Built-in Agents

- **build** - Full access agent for development work
- **plan** - Read-only agent for analysis and planning
- **general** - Complex searches and multi-step tasks
- **explore** - Codebase exploration and understanding

### 🔧 Claude Code Features

- ✅ File editing with diffs
- ✅ Terminal command execution
- ✅ MCP (Model Context Protocol) support
- ✅ Memory and context persistence
- ✅ Tool use with parallel calls

### 🌐 Browser Automation (from Cline)

```bash
> Test the login flow in the browser
# Navi launches browser, clicks, types, captures screenshots
```

### 📝 Checkpointing (from Gemini CLI)

```bash
/checkpoint save "before-refactor"
# ... make changes ...
/checkpoint restore "before-refactor"
```

### ☁️ Cloud Agents (from Continue)

Run agents in the background on:
- PR opens
- Scheduled times
- Custom event triggers

---

## Parallel Agents

Navi's killer feature is true parallel agent execution. Instead of waiting for one agent to finish before starting another, you can:

1. **Launch multiple agents concurrently**
2. **Each agent works independently**
3. **Results merge seamlessly**

### Example: Parallel Refactoring

```
User: Refactor the authentication module. Launch agents in parallel to:
1. Update the backend auth logic
2. Update the frontend auth components
3. Update the tests
4. Update the documentation

Navi: Launching 4 agents in parallel...
  @backend: Working on server/auth/...
  @frontend: Working on client/components/auth/...
  @test: Writing tests for auth module...
  @docs: Updating AUTH.md...

✅ All 4 agents completed in 45 seconds (vs ~3 minutes sequential)
```

### Configuration

```yaml
# .navi/config.yaml
agents:
  parallel:
    max_concurrent: 4
    timeout: 300
```

---

## Provider Support

Navi is provider-agnostic and supports:

| Provider | Models |
|----------|--------|
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 Opus |
| **OpenAI** | GPT-4o, GPT-4 Turbo, o1 |
| **Google** | Gemini 2.0 Flash, Gemini 1.5 Pro |
| **Local** | Ollama, LM Studio, any OpenAI-compatible |
| **AWS Bedrock** | Claude, Titan |
| **Azure OpenAI** | GPT-4, GPT-3.5 |

---

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Configuration](./docs/config.md)
- [Agents](./docs/agents.md)
- [Tools](./docs/tools.md)
- [MCP Servers](./docs/mcp-servers.md)
- [Parallel Execution](./docs/parallel.md)

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## License

MIT License - see [LICENSE](./LICENSE)

---

<p align="center">
  <strong>Navi</strong> - Navigate your code with AI
</p>
