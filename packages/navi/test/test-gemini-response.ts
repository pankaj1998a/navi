// Test script to directly test the Gemini CLI provider
import { getAccessToken } from "../src/provider/gemini-cli"

async function testGeminiResponse() {
    console.log("Testing Gemini CLI Provider Response...")

    try {
        // Get access token
        const token = await getAccessToken()
        if (!token) {
            console.error("❌ Failed to get access token")
            return
        }

        console.log("✅ Access token obtained")

        // Test the API endpoint directly
        const model = "gemini-2.5-flash"
        const prompt = "What's 2+2?"

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                { text: prompt }
                            ]
                        }
                    ]
                })
            }
        )

        if (!response.ok) {
            const errorText = await response.text()
            console.error(`❌ API request failed: ${response.status} ${response.statusText}`)
            console.error(`Error details: ${errorText}`)
            return
        }

        const data = await response.json()
        console.log("✅ API response received")

        // Extract and display the response
        const candidates = data.candidates
        if (candidates && candidates.length > 0) {
            const content = candidates[0].content
            if (content && content.parts) {
                const text = content.parts.map((part: any) => part.text).join("")
                console.log(`Response: ${text}`)
            }
        } else {
            console.error("❌ No valid response candidates found")
        }

        console.log("\n🎉 Success! The Gemini CLI provider is working and returning responses.")

    } catch (error) {
        console.error("\n❌ Error:", error)
    }
}

testGeminiResponse()
