
const url = "https://opencode.ai/zen/v1/chat/completions";
const model = "kimi-k2.5-free";

async function testHeaders(referer: string, title: string) {
    console.log(`Testing with Referer: ${referer}, Title: ${title}`);
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer public",
                "HTTP-Referer": referer,
                "X-Title": title,
                "User-Agent": "opencode/1.0"
            },
            body: JSON.stringify({
                model,
                messages: [{ role: "user", content: "hello" }]
            })
        });
        console.log(`[TEST CASE] Referer: "${referer}", Title: "${title}" => Status: ${res.status}`);
        if (res.status === 429) {
            console.log(`  -> FAILED: Rate Limited (Retry-After: ${res.headers.get("Retry-After")})`);
        } else if (res.status === 200) {
            console.log("  -> SUCCESS");
        } else {
            console.log(`  -> FAILED: Unexpected status ${res.status}`);
        }
    } catch (e) {
        console.error(`  -> ERROR: ${e}`);
    }
    console.log("----------------------------------------");
}

await testHeaders("https://navi.ai/", "navi");
await testHeaders("opencode.ai", "OpenCode");
await testHeaders("https://opencode.ai", "OpenCode");
