import fs from "fs";
import path from "path";

async function main() {
    // Find data directory based on platform
    let dataDir;
    if (process.platform === "win32") {
        dataDir = path.join(process.env.APPDATA || "", "navi");
    } else if (process.platform === "darwin") {
        dataDir = path.join(process.env.HOME || "", "Library", "Application Support", "navi");
    } else {
        dataDir = path.join(process.env.HOME || "", ".navi");
    }

    const authPath = path.join(dataDir, "auth.json");
    console.log("Auth file path:", authPath);

    if (fs.existsSync(authPath)) {
        console.log("Reading current auth file...");
        const authData = JSON.parse(fs.readFileSync(authPath, "utf8"));

        console.log("Current providers:", Object.keys(authData));

        // Remove Antigravity credentials
        delete authData["google-antigravity"];

        console.log("Writing updated auth file...");
        fs.writeFileSync(authPath, JSON.stringify(authData, null, 2));
        console.log("Antigravity credentials removed successfully");
    } else {
        console.log("Auth file not found");
    }
}

main().catch((err) => {
    console.error("Error clearing Antigravity credentials:", err);
    process.exit(1);
});
