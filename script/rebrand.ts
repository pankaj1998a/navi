
import { readdir, stat, readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TARGET_DIRS = ["packages", "script"];
const IGNORE_DIRS = ["node_modules", ".git", "dist", "build", ".turbo", ".cache"];
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".mdx", ".css", ".yml", ".yaml", ".toml"];

async function walk(dir: string) {
    const files = await readdir(dir);

    for (const file of files) {
        if (IGNORE_DIRS.includes(file)) continue;

        const path = join(dir, file);
        const s = await stat(path);

        if (s.isDirectory()) {
            await walk(path);
        } else if (s.isFile() && EXTENSIONS.includes(extname(path))) {
            await processFile(path);
        }
    }
}

async function processFile(path: string) {
    try {
        const content = await readFile(path, "utf-8");
        let newContent = content;

        // 1. Replace Scope Imports (Critical)
        newContent = newContent.replace(/@navi-ai\//g, "@navi-ai/");

        // 2. Replace Branding (Case Sensitive)
        newContent = newContent.replace(/Navi/g, "Navi");

        // 3. Replace lowercase references (careful with this one)
        // We want to match 'navi' but maybe avoid things like 'lonavid' (unlikely but possible)
        // Using a simpler replacement for now as 'navi' is quite specific.
        newContent = newContent.replace(/navi/g, "navi");

        // 4. Fix specific package names if they were missed
        newContent = newContent.replace(/"name": "navi"/g, '"name": "navi"');

        if (content !== newContent) {
            console.log(`Updating ${path}`);
            await writeFile(path, newContent);
        }
    } catch (error) {
        console.error(`Error processing ${path}:`, error);
    }
}

console.log("Starting rebranding...");
for (const dir of TARGET_DIRS) {
    await walk(join(ROOT, dir));
}
console.log("Rebranding complete.");
