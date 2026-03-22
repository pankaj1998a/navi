import fs from "fs";
import path from "path";

const homedir = process.env.HOME || process.env.USERPROFILE || "C:\\Users\\X380 Yoga";
const dataDir = path.join(homedir, ".local", "share", "navi");
const authPath = path.join(dataDir, "auth.json");

fs.writeFileSync(authPath, JSON.stringify({}));
console.log("Auth file cleared at:", authPath);
