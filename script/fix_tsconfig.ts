import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function updateTsConfig(dir) {
    const files = readdirSync(dir);
    for (const file of files) {
        const fullPath = join(dir, file);
        if (statSync(fullPath).isDirectory()) {
            if (file === 'node_modules' || file === '.git') continue;
            updateTsConfig(fullPath);
        } else if (file === 'tsconfig.json') {
            try {
                const text = readFileSync(fullPath, 'utf8');
                const content = JSON.parse(text);
                if (!content.compilerOptions) content.compilerOptions = {};
                if (!content.compilerOptions.types) {
                    content.compilerOptions.types = ["node", "bun"];
                    writeFileSync(fullPath, JSON.stringify(content, null, 2));
                    console.log(`Updated ${fullPath}`);
                }
            } catch (e) {
                console.error(`Failed to update ${fullPath}: ${e.message}`);
            }
        }
    }
}

updateTsConfig('packages');
