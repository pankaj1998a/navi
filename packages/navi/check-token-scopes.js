import fs from "fs";
import path from "path";

async function getAuthToken() {
    const homedir = process.env.HOME || process.env.USERPROFILE || "C:\\Users\\X380 Yoga";
    const dataDir = path.join(homedir, ".local", "share", "navi");
    const authPath = path.join(dataDir, "auth.json");

    if (!fs.existsSync(authPath)) {
        throw new Error("Auth file not found at " + authPath);
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

async function checkTokenInfo(token) {
    const url = "https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(token);

    try {
        const response = await fetch(url);
        console.log("Token info response status:", response.status, response.statusText);

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Error getting token info:", errorText);
            return null;
        }

        const data = await response.json();
        console.log("Token info:", JSON.stringify(data, null, 2));
        return data;
    } catch (error) {
        console.error("Network error:", error);
        return null;
    }
}

async function main() {
    try {
        const token = await getAuthToken();

        console.log("Access token obtained successfully");
        console.log("Token prefix:", token.substring(0, 20), "...");

        await checkTokenInfo(token);
    } catch (error) {
        console.error("Error:", error);
    }
}

main().catch(console.error);