# Navi AI Agent

> AI-powered coding assistant for your terminal with parallel agent execution

[![npm version](https://badge.fury.io/js/navi-ai-agent.svg)](https://www.npmjs.com/package/navi-ai-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Navi is a powerful AI coding assistant that runs directly in your terminal. It features a beautiful TUI (Terminal User Interface) and supports multiple AI providers including Claude, GPT, Gemini, and more.

## ✨ Features

- 🚀 **Parallel Agent Execution** - Run multiple AI agents simultaneously to solve complex tasks.
- 🎨 **Beautiful TUI** - A modern, responsive terminal interface with multiple themes (Catppuccin, Tokyo Night, etc.).
- 🔌 **Multi-Provider Support** - Native support for Anthropic, OpenAI, Google Gemini, GitHub Copilot, and 75+ providers via OpenRouter.
- 🛠️ **Tool Integration** - AI can read/write files, run shell commands, fetch web content, and search your codebase.
- 📦 **MCP Support** - Full support for the Model Context Protocol (MCP) to extend Navi with custom tools and resources.
- 🔒 **Permission System** - You're always in control. Navi asks for permission before running potentially destructive commands.

## 📦 Installation

### Using npm (Recommended)

```bash
npm install -g navi-ai-agent
```

### Using pnpm

```bash
pnpm add -g navi-ai-agent
```

### Using yarn

```bash
yarn global add navi-ai-agent
```

### Using bun

```bash
bun add -g navi-ai-agent
```

## 🛠️ Automated Installation (GitHub)

If you have cloned the repository, run the installer for your platform:

- **Windows**: `.\install.ps1` (PowerShell)
- **Mac/Linux**: `./install.sh`

## 🔄 Update & Uninstall

- **Update**: Run `.\update.ps1` (Windows) or `./update.sh` (Mac/Linux)
- **Uninstall**: Run `.\uninstall.ps1` (Windows) or `./uninstall.sh` (Mac/Linux)

## 🛠️ Manual Installation (GitHub)

If you prefer to install directly from the source code:

1. **Clone the repo**: `git clone https://github.com/pankaj/navi.git`
2. **Install dependencies**: `bun install` (requires [Bun](https://bun.sh))
3. **Link globally**: `cd packages/navi && bun link`

This will make the `navi` command available everywhere using the latest code from your local machine.

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

Navi is an open-source project. We welcome contributions of all kinds! Please see our [Contributing Guide](https://github.com/pankaj/navi/blob/main/CONTRIBUTING.md).

## 📄 License

MIT © Pankaj

---

**Navi** - Your terminal, supercharged with AI 🚀
