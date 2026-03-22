#!/usr/bin/env bun

// Script to fix Gemini CLI provider by forcing re-authentication
import { GEMINI_SCOPES } from "./src/provider/gemini-cli"
import { Auth } from "./src/auth"
import fs from "fs"
import path from "path"

async function main() {
    console.log("=== Fixing Gemini CLI Provider ===")

    try {
        // Check current scopes
        console.log("\n1. Checking current OAuth scopes:")
        console.log(GEMINI_SCOPES.join("\n"))

        // Note: We use the same scopes as official gemini-cli (3 scopes, not 4)
        // The generative-language scope was incorrectly added and causes auth issues
        if (GEMINI_SCOPES.includes("https://www.googleapis.com/auth/generative-language")) {
            console.error("\n❌ Incorrect scope detected: generative-language")
            console.log("Please update src/provider/gemini-cli.ts to remove this scope")
            return
        }

        console.log("\n✅ Scopes are correct (matching official gemini-cli)")

        // Check if auth file exists
        const authPath = path.join(process.env.LOCALAPPDATA || process.env.HOME || "", ".local", "share", "navi", "auth.json")
        console.log("\n2. Checking auth file:", authPath)

        if (fs.existsSync(authPath)) {
            const authData = JSON.parse(fs.readFileSync(authPath, "utf8"))
            const hasGeminiAuth = authData["gemini-cli"]

            if (hasGeminiAuth) {
                console.log("\n⚠️  Found existing Gemini CLI authentication")
                console.log("\n3. Forcing re-authentication with correct scopes:")

                delete authData["gemini-cli"]
                fs.writeFileSync(authPath, JSON.stringify(authData, null, 2))
                console.log("✅ Authentication deleted successfully")
            } else {
                console.log("\nℹ️  No existing Gemini CLI authentication found")
            }
        }

        console.log("\n=== Fix Complete ===")
        console.log("\nNext Steps:")
        console.log("1. Run: bun run navi auth login")
        console.log("2. Select \"Gemini CLI\" from the list")
        console.log("3. Complete the OAuth flow in your browser")
        console.log("4. Test with: bun run navi run --provider gemini-cli --model gemini-2.5-flash 'What's 2+2?'")
        console.log("\nThis will obtain a new access token with the correct scopes (matching official gemini-cli).")

    } catch (error) {
        console.error("\n❌ Error:", error)
    }
}

main()
