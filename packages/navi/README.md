# Navi AI Agent

> AI-powered coding assistant for your terminal with parallel agent execution

[![npm version](https://badge.fury.io/js/navi-ai-agent.svg)](https://www.npmjs.com/package/navi-ai-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Navi is a powerful AI coding assistant that runs directly in your terminal. Navi is built for speed, scale, and deep integration with your development workflow. It features a beautiful TUI (Terminal User Interface) and supports multiple AI providers including Claude, GPT, Gemini, and more.

## ✨ Features

- 🚀 **Parallel Agent Execution** - Run multiple AI agents simultaneously to solve complex tasks.
- 🎨 **Beautiful TUI** - A modern, responsive terminal interface with multiple themes (Catppuccin, Tokyo Night, etc.).
- 🔌 **Multi-Provider Support** - Native support for Anthropic, OpenAI, Google Gemini, GitHub Copilot, and 75+ providers via OpenRouter.
- 🛠️ **Tool Integration** - AI can read/write files, run shell commands, fetch web content, and search your codebase.
- 📦 **MCP Support** - Full support for the Model Context Protocol (MCP) to extend Navi with custom tools and resources.
- 🔒 **Permission System** - You're always in control. Navi asks for permission before running potentially destructive commands.

## 📦 Installation

### Method 1: Quick Install (Recommended)

**Mac/Linux:**
```bash
curl -fsSL https://github.com/pankaj1998a/navi/raw/main/install | bash
```

**Windows (PowerShell):**
```powershell
irm https://github.com/pankaj1998a/navi/raw/main/install.ps1 | iex
```

### Method 2: Using npm

```bash
npm install -g navi-ai-agent
```

**Using pnpm:**
```bash
pnpm add -g navi-ai-agent
```

**Using yarn:**
```bash
yarn global add navi-ai-agent
```

**Using bun:**
```bash
bun add -g navi-ai-agent
```

### Method 3: Install from Source

If you have cloned the repository, run the installer for your platform:

- **Windows**: `.\install.ps1` (PowerShell)
- **Mac/Linux**: `./install.sh`

**Manual Installation:**
```bash
# 1. Clone the repo
git clone https://github.com/pankaj1998a/navi.git
cd navi

# 2. Install dependencies (requires Bun)
bun install

# 3. Build for your platform
cd packages/navi
bun run build --single

# 4. Run directly
./dist/navi-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/')/bin/navi
```

### Method 4: Development Mode

For active development and testing:

```bash
git clone https://github.com/pankaj1998a/navi.git
cd navi
bun install
cd packages/navi
bun link
```

This makes the `navi` command available using the latest code from your local machine.

## 🔄 Update & Uninstall

**Quick Install Method:**
- **Update**: Rerun the quick install command
- **Uninstall**: Remove the installed files from `~/.navi/bin` and remove PATH additions

**npm Method:**
- **Update**: `npm update -g navi-ai-agent`
- **Uninstall**: `npm uninstall -g navi-ai-agent`

**Source/Development Method:**
- **Update**: `git pull` and `bun install`
- **Uninstall**: Run `bun unlink` and remove the cloned directory

## 🚀 Quick Start

```bash
# Start the interactive TUI
navi

# Ask a quick question or give a command
navi "Explain how the authentication logic works in this project"

# Continue your last session
navi -c

# Use a specific model for this session
navi -m anthropic/claude-3-5-sonnet-latest
```

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Open command palette |
| `Ctrl+X M` | Switch AI Model |
| `Ctrl+X L` | Switch/List Sessions |
| `Ctrl+X N` | Start New Session |
| `Ctrl+X T` | Change Theme |
| `Esc` | Stop AI generation / Cancel |
| `Ctrl+C` | Exit Navi |

## 🔐 Connect Providers

On your first run, Navi will guide you through connecting your preferred AI providers. You can also manage connections anytime:

```bash
navi
# Press Ctrl+P and type "connect" to add new providers
```

Supported providers include:
- **Anthropic** (Claude 3.5 Sonnet/Opus)
- **OpenAI** (GPT-4o, GPT-4 Turbo)
- **Google** (Gemini 1.5 Pro/Flash)
- **GitHub Copilot**
- **OpenRouter** (Access to Llama 3, Mistral, etc.)

## 📁 Configuration

Navi works out of the box, but you can customize it via `navi.json` in your project root or `~/.config/navi/navi.json` for global settings:

```json
{
  "model": "anthropic/claude-3-5-sonnet-latest",
  "theme": "catppuccin-mocha",
  "editor": "code"
}
```

## 📖 Documentation

For full documentation, guides, and advanced configuration, visit [navi.ai/docs](https://navi.ai/docs)

## 🤝 Contributing

Navi is an open-source project. We welcome contributions of all kinds! Please see our [Contributing Guide](https://github.com/pankaj1998a/navi/blob/main/CONTRIBUTING.md).

## 📄 License

MIT © Pankaj

---

**Navi** - Your terminal, supercharged with AI 🚀
