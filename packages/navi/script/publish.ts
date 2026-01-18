#!/usr/bin/env bun

/**
 * Navi npm publish script
 * 
 * This script builds and publishes Navi to npm.
 * It creates platform-specific packages for each supported OS/arch combo.
 */

import { $ } from "bun"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

import pkg from "../package.json"
import { Script } from "@navi-ai/script"
import { binaries } from "./build"

const dryRun = !process.argv.includes("--publish")

console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                     Navi npm Publish Script                      ║
╠══════════════════════════════════════════════════════════════════╣
║  Version: ${Script.version.padEnd(54)}║
║  Channel: ${Script.channel.padEnd(54)}║
║  Mode:    ${(dryRun ? "DRY RUN (pack only)" : "PUBLISH TO NPM").padEnd(54)}║
╚══════════════════════════════════════════════════════════════════╝
`)

// Step 1: Ensure build is complete
console.log("📦 Checking build output...")
const distDir = path.join(dir, "dist")
if (!fs.existsSync(distDir)) {
  console.log("⚠️  No dist folder found. Running build first...")
  await $`bun run build`
}

// Step 2: Publish each platform package
console.log("\n📤 Publishing platform packages...\n")

const binaryList = Object.keys(binaries)
for (const name of binaryList) {
  const pkgDir = path.join(distDir, name)
  if (!fs.existsSync(pkgDir)) {
    console.log(`⚠️  Skipping ${name} - not found`)
    continue
  }

  const version = (binaries as any)[name]
  console.log(`  ${name}@${version}`)

  if (dryRun) {
    await $`cd ${pkgDir} && npm pack`.quiet()
  } else {
    try {
      await $`cd ${pkgDir} && npm publish --access public`.quiet()
      console.log(`    ✅ Published`)
    } catch (e: any) {
      console.log(`    ❌ Failed: ${e.message || e}`)
    }
  }
}

// Step 3: Update main package for publishing
console.log("\n📦 Preparing main package...")

const mainPkg: any = JSON.parse(JSON.stringify(pkg))
mainPkg.version = Script.version

// Update optionalDependencies versions to match current release
if (mainPkg.optionalDependencies) {
  for (const dep of Object.keys(mainPkg.optionalDependencies)) {
    mainPkg.optionalDependencies[dep] = Script.version
  }
}

// Clean up dependencies for npm (remove workspace/catalog)
if (mainPkg.devDependencies) delete mainPkg.devDependencies
const deps = mainPkg.dependencies || {}
for (const dep of Object.keys(deps)) {
  if (deps[dep].includes("workspace:") || deps[dep].includes("catalog:")) {
    delete deps[dep]
  }
}

// Write temporary package.json for publishing
const publishPkgPath = path.join(dir, "package.publish.json")
fs.writeFileSync(publishPkgPath, JSON.stringify(mainPkg, null, 2))

// Step 4: Final Publish
if (dryRun) {
  console.log("\n📦 Packing main package (dry run)...")
  await $`npm pack`
  console.log("\n✅ Dry run complete! Run with --publish to go live.")
} else {
  console.log("\n🚀 Publishing main package to npm...")
  try {
    fs.copyFileSync(publishPkgPath, path.join(dir, "package.json"))
    await $`npm publish --access public`
    console.log(`\n✅ Successfully published ${mainPkg.name}@${Script.version}!`)
  } catch (e: any) {
    console.error(`❌ Publish failed: ${e.message || e}`)
  } finally {
    // Restore original
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2))
  }
}

if (fs.existsSync(publishPkgPath)) fs.unlinkSync(publishPkgPath)
