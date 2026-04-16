/**
 * Test: Discover what models portal.qwen.ai/v1 supports
 * Run: bun run test-qwen-models.ts
 */

import { Auth } from "./packages/navi/src/auth/index.ts"

async function main() {
    const auth = await Auth.get("qwen-cli")
    if (!auth || auth.type !== "oauth") { console.error("No credentials"); process.exit(1) }

    const token = auth.access
    const baseUrl = "https://portal.qwen.ai/v1"

    console.log("🔍 Listing models at", baseUrl)
    const r = await fetch(`${baseUrl}/models`, {
        headers: { "Authorization": `Bearer ${token}` },
    })
    const text = await r.text()
    console.log("Status:", r.status)
    console.log("Body:", text.substring(0, 3000))

    // Test the models most likely to work
    const candidates = [
        "qwen2.5-coder-32b-instruct",
        "qwen-coder-plus",
        "qwen-plus-latest",
        "qwen-plus",
        "qwen-turbo-latest",
        "qwen-turbo",
        "qwen3-235b-a22b",
        "qwen3-30b-a3b",
        "qwen3-14b",
    ]

    console.log("\n🧪 Testing candidate models...")
    for (const model of candidates) {
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
            },
            body: JSON.stringify({
                model,
                messages: [{ role: "user", content: "hi" }],
                max_tokens: 8,
                stream: false,
            }),
        })
        const body = await res.text()
        const ok = res.status < 400
        const notFound = body.includes("not supported") || body.includes("not found") || res.status === 404
        const icon = ok ? "✅" : notFound ? "🚫" : "❌"
        console.log(`  ${icon} [${res.status}] ${model}`)
        if (ok) console.log("    ", body.substring(0, 200))
    }
}

main().catch(console.error)
