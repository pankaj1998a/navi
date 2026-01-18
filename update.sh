#!/bin/bash

# Navi AI Agent - Mac/Linux Updater
# This script updates Navi to the latest version from GitHub.

set -e

echo -e "\033[0;36m"
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                     Navi AI Agent - Updater                      ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo -e "\033[0m"

# 1. Pull latest code
echo -e "\033[0;36m📥 Pulling latest changes from GitHub...\033[0m"
git pull

# 2. Update dependencies
echo -e "\033[0;36m📦 Updating dependencies...\033[0m"
bun install

# 3. Refresh installation
echo -e "\033[0;36m🛠️  Refreshing installation...\033[0m"
chmod +x install.sh
./install.sh

echo -e "\n\033[0;32m✨ Navi has been updated to the latest version!\033[0m"
echo -e "\033[0;32m🚀 Run 'navi' to start.\033[0m\n"
