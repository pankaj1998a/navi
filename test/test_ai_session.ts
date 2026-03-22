import { BrowserSession } from "./packages/navi/src/tool/browser/session"

async function testPrompt(session: BrowserSession, name: string, url: string) {
    console.log(`\n=================================================`)
    console.log(`Sending query to ${name}...`)
    try {
        const res = await session.launch(url)
        console.log(`[SUCCESS] Attempted fetch from ${name}`)
        const text = res.text || ""
        // Grab a chunk of the text to easily find the answer
        console.log(`Extracted Response:\n${text.replace(/\s+/g, ' ').substring(0, 1500)}...`)
    } catch (e: any) {
        console.error(`[FAILED] Error with ${name}:`, e.message)
    }
}

async function test() {
    console.log("Starting Web Query Test...")
    const session = new BrowserSession()

    // The specific math query the user requested
    const queryStr = "what is the total of 1*28*98"
    const encodedQuery = encodeURIComponent(queryStr)

    try {
        // We add specific Google AI triggers directly to the prompt.
        // Also note: we bypass the login gate for Gemini assuming the persisted profile works!
        await testPrompt(session, "Google AI Overview", `https://www.google.com/search?q=${encodedQuery}+AI+Overview`)
        await testPrompt(session, "Gemini", `https://gemini.google.com/app?q=${encodedQuery}`)

    } finally {
        console.log("\nClosing browser session...")
        await session.close()
    }
}

test()
