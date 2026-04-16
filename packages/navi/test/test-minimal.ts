#!/usr/bin/env bun

// Minimal test script to diagnose Gemini CLI provider issues
import { getAccessToken } from "../src/provider/gemini-cli"
import { GEMINI_SCOPES } from "../src/provider/gemini-cli"
import { Auth } from "../src/auth"

async function runMinimalTest() {
    console.log("=== Gemini CLI Provider Diagnostics ===")

    try {
        console.log("\n1. Current Scopes:")
        console.log(GEMINI_SCOPES.join("\n"))

        console.log("\n2. Current Auth Status:")
        const auth = await Auth.get("gemini-cli")
        console.log("Auth Type:", auth?.type)
        if (auth?.type === "oauth") {
            console.log("Access Token Expires:", new Date(auth.expires).toLocaleString())
            console.log("Has Refresh Token:", !!auth.refresh)
        }

        console.log("\n3. Access Token Test:")
        const token = await getAccessToken()
        if (token) {
            console.log("✅ Access token obtained")
            console.log("Token length:", token.length)

            // Test token validity with a simple API call
            console.log("\n4. Token Validation Test:")
            const response = await fetch(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash",
                {
                    headers: {
                        "Authorization": `Bearer ${token}`
                    }
                }
            )

            if (response.ok) {
                console.log("✅ Token is valid for Gemini API")
                const data = await response.json()
                console.log("Model Name:", data.displayName)
            } else {
                console.log(`❌ API request failed: ${response.status} ${response.statusText}`)
                const errorText = await response.text()
                console.log("Error Details:", errorText)
            }
        } else {
            console.log("❌ No access token available")
        }

    } catch (error) {
        console.error("\n❌ Error:", error)
    }
}

runMinimalTest()
