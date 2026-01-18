#!/bin/bash

# Navi AI Agent - Mac/Linux Uninstaller
# This script removes Navi from your system.

set -e

echo -e "\033[0;33m"
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                   Navi AI Agent - Uninstaller                    ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo -e "\033[0m"

CURRENT_DIR=$(pwd)

# 1. Remove Symlink
if [ -L "/usr/local/bin/navi" ]; then
    sudo rm "/usr/local/bin/navi"
    echo -e "\033[0;32m✅ Removed symlink from /usr/local/bin/navi\033[0m"
fi

# 2. Remove Aliases from shell configs
ALIAS_LINE="alias navi='$CURRENT_DIR/navi-launcher.sh'"

if [ -f "$HOME/.zshrc" ]; then
    sed -i "|$ALIAS_LINE|d" "$HOME/.zshrc"
    echo -e "\033[0;32m✅ Removed alias from .zshrc\033[0m"
fi

if [ -f "$HOME/.bashrc" ]; then
    sed -i "|$ALIAS_LINE|d" "$HOME/.bashrc"
    echo -e "\033[0;32m✅ Removed alias from .bashrc\033[0m"
fi

# 3. Clean up local launcher
if [ -f "$CURRENT_DIR/navi-launcher.sh" ]; then
    rm "$CURRENT_DIR/navi-launcher.sh"
fi

echo -e "\n\033[0;32m✨ Navi has been uninstalled from your system.\033[0m"
echo -e "\033[0;33m🗑️  You can now safely delete the project folder if you wish.\033[0m\n"
