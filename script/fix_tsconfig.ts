import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function updateTsConfig(dir: string): void {
    const files = readdirSync(dir);
    for (const file of files) {
        const fullPath = join(dir, file);
        if (statSync(fullPath).isDirectory()) {
            if (file === 'node_modules' || file === '.git') continue;
            updateTsConfig(fullPath);
        } else if (file === 'tsconfig.json') {
            try {
                const text = readFileSync(fullPath, 'utf8');
                const content = JSON.parse(text) as Record<string, unknown>;
                if (!content.compilerOptions) content.compilerOptions = {};
                const compilerOptions = content.compilerOptions as Record<string, unknown>;
                if (!compilerOptions.types) {
                    compilerOptions.types = ["node", "bun"];
                    writeFileSync(fullPath, JSON.stringify(content, null, 2));
                    console.log(`Updated ${fullPath}`);
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                console.error(`Failed to update ${fullPath}: ${message}`);
            }
        }
    }
}

updateTsConfig('packages');
