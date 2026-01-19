# Navi Deployment Configuration Summary

## ✅ Completed Updates

### 1. Repository References Updated
All repository references have been updated to `pankaj1998a/navi`:
- `.github/workflows/publish.yml`
- `packages/navi/package.json`
- `packages/navi/script/publish-registries.ts`
- `packages/navi/README.md`
- `packages/navi/bin/navi`
- `packages/navi/src/cli/cmd/tui/app.tsx`
- `packages/navi/src/session/prompt/*.txt`
- `install` script

### 2. GitHub Actions Workflows
Updated workflows to work with your repository:
- Changed repository checks from `anomalyco/opencode` to `pankaj1998a/navi`
- Replaced self-hosted `blacksmith-4vcpu-*` runners with standard GitHub runners (`ubuntu-latest`, `windows-latest`)
- Note: `opencode.yml` workflow kept as-is (uses external opencode service for AI code review)

### 3. Installation Scripts
Created/updated installation methods:

#### Quick Install (curl/bash)
```bash
curl -fsSL https://github.com/pankaj1998a/navi/raw/main/install | bash
```

#### Windows PowerShell
```powershell
irm https://github.com/pankaj1998a/navi/raw/main/install.ps1 | iex
```

#### npm Registry
```bash
npm install -g navi-ai-agent
```

#### From Source
Updated `install.sh` (Mac/Linux) and created `install.ps1` (Windows)

### 4. README Documentation
Updated README.md with 4 installation methods:
1. Quick Install (one-liner)
2. npm/pnpm/yarn/bun package managers
3. Install from source
4. Development mode

## 📋 Next Steps

### Required Actions

1. **Update Secrets in GitHub**
   - Add `NPM_TOKEN` for npm publishing
   - Add `GITHUB_TOKEN` (already available, but ensure permissions are set)
   - Consider adding `OPENCODE_API_KEY` if using opencode services

2. **Homebrew/AUR Setup** (Optional)
   - The `publish-registries.ts` script attempts to push to `sst/homebrew-tap` and AUR
   - Create your own tap repository and update line 182:
     ```typescript
     await $`git clone https://${process.env["GITHUB_TOKEN"]}@github.com/pankaj1998a/homebrew-navi.git ./dist/homebrew-tap`
     ```
   - Or comment out lines 181-186 if not using Homebrew

3. **Test Installation**
   - Commit and push changes to your repository
   - Test quick install command
   - Test npm installation after publishing
   - Verify platform-specific binaries are published

### Optional Improvements

1. **Update GitHub URL** in your repo settings if `pankaj1998a` is not correct
2. **Create GitHub Releases** manually for initial versions
3. **Set up automated releases** using the publish workflow
4. **Configure npm provenance** for package verification (currently disabled)

## ⚠️ Important Notes

- **opencode free models**: Still referenced in provider configuration - this is intentional and should remain
- **Platform packages**: When publishing, ensure all platform-specific packages are built and published:
  - `navi-ai-agent-darwin-arm64`
  - `navi-ai-agent-darwin-x64`
  - `navi-ai-agent-linux-arm64`
  - `navi-ai-agent-linux-x64`
  - `navi-ai-agent-windows-arm64`
  - `navi-ai-agent-windows-x64`

- **Current npm version**: 0.1.3 (need to publish 0.1.5)
- **Publish workflow**: Will only run on `pankaj1998a/navi` repository

## 🚀 Publishing to npm

Once ready to publish:

1. Build packages:
   ```bash
   cd navi
   bun install
   cd packages/navi
   bun run build
   ```

2. Publish (dry run first):
   ```bash
   bun run script/publish.ts  # Dry run
   bun run script/publish.ts --publish  # Actual publish
   ```

3. Or use GitHub Actions:
   - Go to Actions tab
   - Run `publish` workflow manually
   - Or push to `dev` branch (triggers auto-publish)

## 📞 Support

For issues or questions, refer to the updated documentation in README.md or open an issue at:
https://github.com/pankaj1998a/navi/issues
