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
const rootPkg = await Bun.file("../../package.json").json()
import { Script } from "@navi-ai/script"
import { build, binaries } from "./build"

const dryRun = !process.argv.includes("--publish")
const otpArg = process.argv.find(arg => arg.startsWith("--otp="))
const otp = otpArg ? otpArg.split("=")[1] : null

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
console.log("📦 Running build...")
await build()
const distDir = path.join(dir, "dist")

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
      const args = ["publish", "--access", "public"]
      if (otp) args.push(`--otp=${otp}`)
      await $`cd ${pkgDir} && npm ${args}`
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
const optionalDeps: Record<string, string> = {}
for (const name of binaryList) {
  optionalDeps[name] = Script.version
}
mainPkg.optionalDependencies = optionalDeps

// Clean up dependencies for npm (remove workspace/catalog)
if (mainPkg.devDependencies) delete mainPkg.devDependencies
const deps = mainPkg.dependencies || {}
const catalog = (rootPkg as any).workspaces?.catalog || {}

for (const dep of Object.keys(deps)) {
  const version = deps[dep]
  if (version.includes("catalog:")) {
    deps[dep] = catalog[dep] || version.replace("catalog:", "")
  } else if (version.includes("workspace:")) {
    deps[dep] = Script.version
  }
}

// Write temporary package.json for publishing
const publishPkgPath = path.join(dir, "package.publish.json")
fs.writeFileSync(publishPkgPath, JSON.stringify(mainPkg, null, 2))

// Step 4: Final Publish
if (dryRun) {
  console.log("\n📦 Packing main package (dry run)...")
  fs.copyFileSync(publishPkgPath, path.join(dir, "package.json"))
  await $`npm pack`
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2))
  console.log("\n✅ Dry run complete! Run with --publish to go live.")
} else {
  console.log("\n🚀 Publishing main package to npm...")
  try {
    fs.copyFileSync(publishPkgPath, path.join(dir, "package.json"))
    const args = ["publish", "--access", "public"]
    if (otp) args.push(`--otp=${otp}`)
    await $`npm ${args}`
    console.log(`\n✅ Successfully published ${mainPkg.name}@${Script.version}!`)
  } catch (e: any) {
    console.error(`❌ Publish failed: ${e.message || e}`)
  } finally {
    // Restore original
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2))
  }
}

if (fs.existsSync(publishPkgPath)) fs.unlinkSync(publishPkgPath)
