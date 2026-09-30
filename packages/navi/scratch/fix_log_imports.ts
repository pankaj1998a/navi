import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const rootDir = 'v:/pankaj/navi-reborn/packages/navi/src';

function processDirectory(dir: string) {
    const files = readdirSync(dir);
    for (const file of files) {
        const fullPath = join(dir, file);
        if (statSync(fullPath).isDirectory()) {
            processDirectory(fullPath);
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
            let content = readFileSync(fullPath, 'utf8');
            const original = content;
            
            // Pattern to match various util/log imports
            // e.g. import * as Log from "@/util/log"
            // e.g. import { Log } from "../util/log"
            // e.g. import Log from "../../util/log"
            
            content = content.replace(/import\s+((\*\s+as\s+Log)|(\{\s*Log\s*\})|(Log))\s+from\s+["'](@\/|\.\.?\/|\.\.\/\.\.\/|\.\.\/\.\.\/\.\.\/)util\/log["']/g, 'import { Log } from "@navi-ai/core/util/log"');
            
            if (content !== original) {
                console.log(`Updated ${fullPath}`);
                writeFileSync(fullPath, content, 'utf8');
            }
        }
    }
}

processDirectory(rootDir);
