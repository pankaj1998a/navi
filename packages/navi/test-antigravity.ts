#!/usr/bin/env bun
/**
 * Test script for Antigravity authentication
 * This script tests the complete auth flow and API access
 */

import { AntigravityAuthHook } from "./src/provider/antigravity"
import { Auth } from "./src/auth"

console.log("🔧 Testing Antigravity Authentication\n")

// Test 1: Check if auth exists
console.log("📋 Step 1: Checking existing auth...")
const existingAuth = await Auth.get("google-antigravity")
if (existingAuth) {
    console.log("✅ Found existing auth:", existingAuth.type)
    const authWithAccount = existingAuth as typeof existingAuth & { accountId?: string }
    if (authWithAccount.accountId) {
        console.log("   Account:", authWithAccount.accountId)
    }
} else {
    console.log("❌ No existing auth found")
    console.log("\n⚠️  Please run: bun ./src/index.ts auth login")
    console.log("   Then select 'Antigravity (Google OAuth)' from the list\n")
    process.exit(1)
}

// Test 2: Load the provider config
console.log("\n📋 Step 2: Loading provider configuration...")
try {
    const getAuth = async () => existingAuth
    if (!AntigravityAuthHook.loader) {
        throw new Error("AntigravityAuthHook.loader is undefined")
    }
    const config = await AntigravityAuthHook.loader(getAuth, {} as any)
    console.log("✅ Provider configuration loaded")
    console.log("   Base URL:", (config as any).baseURL || "default")
    console.log("   Has custom fetch:", !!(config as any).fetch)
} catch (error) {
    console.error("❌ Failed to load provider:", error)
    process.exit(1)
}

// Test 3: Get access token
console.log("\n📋 Step 3: Getting access token...")
try {
    const { getAccessToken } = await import("./src/provider/antigravity")
    const token = await getAccessToken()
    if (token) {
        console.log("✅ Access token retrieved")
        console.log("   Token prefix:", token.substring(0, 20) + "...")
    } else {
        console.log("❌ Failed to get access token")
        process.exit(1)
    }
} catch (error) {
    console.error("❌ Error getting access token:", error)
    process.exit(1)
}

// Test 4: Test API call
console.log("\n📋 Step 4: Testing API access...")
try {
    const { getAccessToken } = await import("./src/provider/antigravity")
    const token = await getAccessToken()

    // Test a simple API call to generativelanguage
    const response = await fetch(
        "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist",
        {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": "antigravity/1.11.5 windows/amd64",
                "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
            },
            body: JSON.stringify({
                metadata: {
                    ideType: "IDE_UNSPECIFIED",
                    platform: "PLATFORM_UNSPECIFIED",
                    pluginType: "GEMINI",
                },
            }),
        }
    )

    if (response.ok) {
        const data = await response.json()
        console.log("✅ API call successful")
        console.log("   Response:", JSON.stringify(data, null, 2))
    } else {
        console.log("⚠️  API call returned status:", response.status)
        const text = await response.text()
        console.log("   Response:", text.substring(0, 200))
    }
} catch (error) {
    console.error("❌ API call failed:", error)
}

console.log("\n✨ Antigravity authentication test complete!\n")
