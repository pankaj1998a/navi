
const urls = [
    "https://opencode.ai/zen/v1/chat/completions"
];

const models = ["kimi-k2.5-free", "gpt-5-nano"];

for (const url of urls) {
    for (const model of models) {
        console.log(`Testing ${model} at ${url}...`);
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer public",
                    "HTTP-Referer": "https://navi.ai/",
                    "X-Title": "navi"
                },
                body: JSON.stringify({
                    model,
                    messages: [{ role: "user", content: "hello" }]
                })
            });
            console.log(`Status: ${res.status}`);
            console.log("Headers:");
            for (const [key, value] of res.headers.entries()) {
                console.log(`  ${key}: ${value}`);
            }
            const text = await res.text();
            console.log(`Body: ${text.substring(0, 200)}...`);
        } catch (e) {
            console.error(e);
        }
        console.log("-".repeat(20));
    }
}
