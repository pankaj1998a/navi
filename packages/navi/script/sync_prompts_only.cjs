const fs = require('fs');
const path = require('path');

const defaultsDir = path.join(__dirname, '../src/agent/defaults');
const promptDir = path.join(__dirname, '../src/agent/prompt');

if (!fs.existsSync(promptDir)) {
    fs.mkdirSync(promptDir, { recursive: true });
}

const files = fs.readdirSync(defaultsDir).filter(f => f.endsWith('.md'));

files.forEach(file => {
    const content = fs.readFileSync(path.join(defaultsDir, file), 'utf8');
    const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);

    if (match) {
        const body = match[2].trim();
        const name = path.basename(file, '.md');

        // Write prompt file
        fs.writeFileSync(path.join(promptDir, `${name}.txt`), body);
        console.log(`Synced ${name}.txt`);
    }
});
