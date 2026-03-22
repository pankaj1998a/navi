import fs from "fs";
import path from "path";

async function getAuthToken() {
    // Navi's auth file location - direct path from find-auth.js
    const authPath = "C:\\Users\\X380 Yoga\\.local\\share\\navi\\auth.json";

    if (!fs.existsSync(authPath)) {
        throw new Error("Auth file not found");
    }

    const authData = JSON.parse(fs.readFileSync(authPath, "utf8"));

    if (!authData["google-antigravity"]) {
        throw new Error("Google Antigravity credentials not found");
    }

    const creds = authData["google-antigravity"];

    if (creds.type !== "oauth") {
        throw new Error("Not OAuth credentials");
    }

    return creds.access;
}

async function testGenerativeLanguageAPI(token) {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:streamGenerateContent?alt=sse";

    const requestBody = {
        contents: [
            {
                parts: [
                    { text: "hi" }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.7,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 2048,
            responseMimeType: "text/plain"
        }
    };

    console.log("Testing Generative Language API...");
    console.log("URL:", url);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody)
        });

        console.log("Status:", response.status, response.statusText);

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Error response:", errorText);
            return false;
        }

        const data = await response.text();
        console.log("Success response:", data.substring(0, 500));
        return true;
    } catch (error) {
        console.error("Network error:", error);
        return false;
    }
}

async function testAntigravityAPI(token) {
    const url = "https://cloudcode-pa.googleapis.com/v1/models/gemini-3-pro:streamGenerateContent?alt=sse";

    const requestBody = {
        contents: [
            {
                parts: [
                    { text: "hi" }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.7,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 2048,
            responseMimeType: "text/plain"
        }
    };

    console.log("\nTesting Antigravity API...");
    console.log("URL:", url);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody)
        });

        console.log("Status:", response.status, response.statusText);

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Error response:", errorText);
            return false;
        }

        const data = await response.text();
        console.log("Success response:", data.substring(0, 500));
        return true;
    } catch (error) {
        console.error("Network error:", error);
        return false;
    }
}

async function main() {
    try {
        const token = await getAuthToken();

        console.log("Access token obtained successfully");
        console.log("Token prefix:", token.substring(0, 20), "...");

        const genLangSuccess = await testGenerativeLanguageAPI(token);
        const antigravitySuccess = await testAntigravityAPI(token);

        if (genLangSuccess) {
            console.log("\n✅ Generative Language API works");
        }

        if (antigravitySuccess) {
            console.log("\n✅ Antigravity API works");
        }

        if (!genLangSuccess && !antigravitySuccess) {
            console.log("\n❌ Both APIs failed");
        }

    } catch (error) {
        console.error("Error:", error);
    }
}

main().catch(console.error);
