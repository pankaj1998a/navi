import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { GeminiCliProvider } from "./src/provider/providers/gemini-cli.ts"

async function main() {
    const providerInfo = await GeminiCliProvider.load()
    if (!providerInfo || !providerInfo.options) {
        console.log("no options")
        return
    }

    const google = createGoogleGenerativeAI({
        apiKey: providerInfo.options.apiKey,
        baseURL: providerInfo.options.baseURL,
        fetch: providerInfo.options.fetch,
    })

    const model = providerInfo.getModel(google, "gemini-3.1-pro-preview")

    // Quick token test
    try {
        const text = "Hello what is 2+2?"
        // model isn't the API directly, it's a LanguageModel
        // but we can test fetch manually
        console.log("Provider options fetch ready.")

        const res = await providerInfo.options.fetch(providerInfo.options.baseURL + "/models/gemini-3.1-pro-preview:generateContent", {
            method: "POST",
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: "Respond 'yes'" }] }]
            })
        })
        console.log(res.status)
        console.log(await res.text())
        // model.generateContent(...) 
    } catch (e) {
        console.error("test error:", e)
    }
}
main()
