#!/bin/bash
# scripts/audit-deps.sh

echo "Analyzing dependencies..."

# Check if npm-check-duplicates is installed
if ! command -v npm-check-duplicates &> /dev/null; then
    echo "npm-check-duplicates not found. Skipping duplicate check."
else
    # Find duplicate dependencies
    npx npm-check-duplicates
fi

# Check if depcheck is installed
if ! command -v depcheck &> /dev/null; then
    echo "depcheck not found. Skipping unused dependency check."
else
    # Find unused dependencies
    # Ignoring typical dev/build tools and types
    npx depcheck --ignores="@types/*,eslint*,prettier*,typescript*,@babel/*,bun-types"
fi

echo "Checking for deprecated packages..."
npm outdated

echo "Audit complete."
