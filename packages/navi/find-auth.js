import fs from "fs";
import path from "path";
import os from "os";

// Check common auth file locations
const homeDir = os.homedir();
const candidates = [
    path.join(homeDir, ".local", "share", "navi", "auth.json"),
    path.join(homeDir, ".navi", "auth.json"),
    path.join(process.env.APPDATA || "", "navi", "auth.json")
];

for (const candidate of candidates) {
    console.log(`Checking: ${candidate}`);
    if (fs.existsSync(candidate)) {
        console.log("Found!");
        const authData = JSON.parse(fs.readFileSync(candidate, "utf8"));
        console.log("Auth keys:", Object.keys(authData));
        if (authData["google-antigravity"]) {
            console.log("\nGoogle Antigravity credentials found!");
            console.log(JSON.stringify(authData["google-antigravity"], null, 2));
        } else {
            console.log("\nNo google-antigravity in this file");
        }
    } else {
        console.log("File not found");
    }
    console.log();
}
