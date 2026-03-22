const fs = require('fs');

let content = fs.readFileSync('src/tool/registry.ts', 'utf8');

content = content.replace('import { InvalidTool } from "./invalid"', 'import { InvalidTool } from "./invalid"\nimport { ShadowWorkspaceTool } from "./shadow"');
content = content.replace('      CheckpointTool,', '      CheckpointTool,\n      ShadowWorkspaceTool,');

fs.writeFileSync('src/tool/registry.ts', content);
