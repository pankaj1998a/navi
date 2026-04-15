#!/bin/bash
echo "Analyzing dependencies..."

# Find duplicate dependencies
bunx npm-check-duplicates

# Find unused dependencies
bunx depcheck --ignores="@types/*,eslint*,prettier*"

# Check bundle size
bunx bundlesize

echo "Checking for deprecated packages..."
bun outdated
