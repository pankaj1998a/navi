import fs from "fs";
import path from "path";

async function main() {
    const homedir = process.env.HOME || process.env.USERPROFILE || "C:\\Users\\X380 Yoga";
    const dataDir = path.join(homedir, ".local", "share", "navi");
    const authPath = path.join(dataDir, "auth.json");

    let refreshToken = null;

    if (fs.existsSync(authPath)) {
        const authData = JSON.parse(fs.readFileSync(authPath, "utf8"));
        if (authData["google-antigravity"] && authData["google-antigravity"].refresh) {
            refreshToken = authData["google-antigravity"].refresh;
            console.log("Refresh token to revoke:", refreshToken.substring(0, 20), "...");

            // Revoke refresh token
            const revokeUrl = "https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(refreshToken);
            const revokeResponse = await fetch(revokeUrl, { method: "POST" });
            console.log("Revoke response status:", revokeResponse.status, revokeResponse.statusText);
        }
    }

    // Clear auth file
    fs.writeFileSync(authPath, JSON.stringify({}, "utf8"));
    console.log("Auth file cleared:", authPath);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});