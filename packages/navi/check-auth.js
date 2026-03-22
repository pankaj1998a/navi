import fs from "fs";
import path from "path";

async function checkAuth() {
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

    if (!fs.existsSync(authPath)) {
        console.log("Auth file does not exist");
        return;
    }

    const authData = JSON.parse(fs.readFileSync(authPath, "utf8"));
    console.log("Auth data keys:", Object.keys(authData));
    console.log("Auth data:", JSON.stringify(authData, null, 2));
}

checkAuth().catch(console.error);
