
const url = "https://opencode.ai/zen/v1/chat/completions";
const model = "kimi-k2.5-free";

async function testHeaders(referer, title, userAgent) {
    console.log(`Testing with UA: ${userAgent}, Referer: ${referer}`);
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer public",
                "HTTP-Referer": referer,
                "X-Title": title,
                "User-Agent": userAgent
            },
            body: JSON.stringify({
                model,
                messages: [{ role: "user", content: "hello" }]
            })
        });
        console.log(`Status: ${res.status}`);
        if (res.status === 429) {
            console.log(`Retry-After: ${res.headers.get("Retry-After")}`);
        } else if (res.status === 200) {
            console.log("Success!");
        }
    } catch (e) {
        console.error(e);
    }
    console.log("-".repeat(20));
}

await testHeaders("opencode.ai", "OpenCode", "opencode/1.0");
await testHeaders("https://opencode.ai", "OpenCode", "Mozilla/5.0");
