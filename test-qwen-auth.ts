/**
 * Test script: Probe all possible Qwen endpoint variations
 * Run: bun run test-qwen-auth.ts
 */

import { Auth } from "./packages/navi/src/auth/index.ts"

async function testEndpoint(label: string, url: string, token: string, extraHeaders: Record<string,string> = {}) {
    const body = JSON.stringify({
        model: "qwen-max",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 16,
        stream: false,
    })
    try {
        const r = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
                ...extraHeaders,
            },
            body,
        })
        const text = await r.text()
        const icon = r.status < 400 ? "✅" : r.status === 401 ? "🔑" : r.status === 404 ? "🚫" : "❌"
        console.log(`  ${icon} [${r.status}] ${label}`)
        if (!r.ok) console.log(`     ${text.substring(0, 200)}`)
    } catch (e: any) {
        console.log(`  💥 [ERR] ${label}: ${e.message}`)
    }
}

async function main() {
    const auth = await Auth.get("qwen-cli")
    if (!auth || auth.type !== "oauth") {
        console.error("❌ No qwen-cli OAuth credentials found")
        process.exit(1)
    }

    const token = auth.access
    const resourceUrl = (auth as any).resourceUrl ?? ""
    const expires = auth.expires

    console.log("📋 Credentials:")
    console.log("  token prefix:", token?.substring(0, 24) + "...")
    console.log("  resourceUrl: ", resourceUrl)
    console.log("  expires:     ", new Date(expires).toISOString())
    console.log("  expired?     ", Date.now() > expires)
    console.log("")

    console.log("🔬 Testing all endpoint variations...\n")

    // portal.qwen.ai paths
    await testEndpoint("portal.qwen.ai/v1", "https://portal.qwen.ai/v1/chat/completions", token, { "X-DashScope-AuthType": "qwen-oauth" })
    await testEndpoint("portal.qwen.ai/api/v1", "https://portal.qwen.ai/api/v1/chat/completions", token, { "X-DashScope-AuthType": "qwen-oauth" })
    await testEndpoint("portal.qwen.ai/api/chat", "https://portal.qwen.ai/api/chat/completions", token)

    // DashScope paths with oauth header
    await testEndpoint("dashscope compatible-mode + oauth header", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", token, { "X-DashScope-AuthType": "qwen-oauth" })
    // DashScope paths without oauth header (treat as regular apikey)
    await testEndpoint("dashscope compatible-mode NO oauth header", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", token)
    // DashScope v1 directly
    await testEndpoint("dashscope /api/v1", "https://dashscope.aliyuncs.com/api/v1/chat/completions", token)

    // International DashScope
    await testEndpoint("dashscope-intl compatible-mode + oauth", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions", token, { "X-DashScope-AuthType": "qwen-oauth" })
    
    console.log("\nDone.")
}

main().catch(console.error)
