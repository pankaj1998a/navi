#!/bin/bash
echo "Analyzing dependencies..."

# Find duplicate dependencies
npx npm-check-duplicates

# Find unused dependencies
npx depcheck --ignores="@types/*,eslint*,prettier*"

# Check bundle size
npx bundlesize

echo "Checking for deprecated packages..."
npm outdated
