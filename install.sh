#!/bin/bash

# Navi AI Agent - Mac/Linux Installer
# This script installs Navi from source on your device.

set -e

echo -e "\033[0;36m"
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                    Navi AI Agent - Installer                     ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo -e "\033[0m"

# 1. Check for Bun
if ! command -v bun &> /dev/null; then
    echo -e "\033[0;33mℹ️  Bun is not installed. Navi requires Bun to run from source.\033[0m"
    read -p "Would you like to install Bun now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "\033[0;36m📥 Installing Bun...\033[0m"
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
    else
        echo -e "\033[0;31m❌ Installation cancelled. Bun is required.\033[0m"
        exit 1
    fi
fi

# 2. Install Dependencies
echo -e "\033[0;36m📦 Installing project dependencies...\033[0m"
bun install

# 3. Create Symlink
echo -e "\033[0;36m🛠️  Setting up global command...\033[0m"
CURRENT_DIR=$(pwd)
BIN_PATH="/usr/local/bin/navi"

# Create a wrapper script
cat << EOF > "$CURRENT_DIR/navi-launcher.sh"
#!/bin/bash
bun run --cwd "$CURRENT_DIR/packages/navi" --conditions=browser "$CURRENT_DIR/packages/navi/src/index.ts" "\$@"
EOF

chmod +x "$CURRENT_DIR/navi-launcher.sh"

# Try to symlink to /usr/local/bin
if [ -w "/usr/local/bin" ]; then
    ln -sf "$CURRENT_DIR/navi-launcher.sh" "$BIN_PATH"
    echo -e "\033[0;32m✅ Created symlink at $BIN_PATH\033[0m"
else
    echo -e "\033[0;33m⚠️  Cannot write to /usr/local/bin. Adding to .bashrc/.zshrc instead...\033[0m"
    ALIAS_LINE="alias navi='$CURRENT_DIR/navi-launcher.sh'"
    
    if [ -f "$HOME/.zshrc" ]; then
        echo "$ALIAS_LINE" >> "$HOME/.zshrc"
        echo -e "\033[0;32m✅ Added alias to .zshrc\033[0m"
    fi
    
    if [ -f "$HOME/.bashrc" ]; then
        echo "$ALIAS_LINE" >> "$HOME/.bashrc"
        echo -e "\033[0;32m✅ Added alias to .bashrc\033[0m"
    fi
fi

echo -e "\n\033[0;32m✨ Navi has been successfully installed!\033[0m"
echo -e "\033[0;32m🚀 You can now run 'navi' from any terminal window.\033[0m"
echo -e "\033[0;33m💡 Note: You may need to restart your terminal or run 'source ~/.zshrc' for changes to take effect.\033[0m\n"
