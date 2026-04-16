import { geminiCliFetch } from "../src/provider/gemini-cli"
import { Log } from "../src/util/log"

async function testFetchHandling() {
    console.log("=== Testing Gemini CLI Fetch Error Handling ===")

    try {
        const response = await geminiCliFetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash")

        console.log("Response Status:", response.status)
        if (response.status === 403) {
            console.log("\nNote: The 403 error above is EXPECTED until you re-login.")
            console.log("The log should have shown the 'Insufficient authentication scopes' error message.")
        }
    } catch (error) {
        console.error("Fetch Error:", error)
    }
}

testFetchHandling()
