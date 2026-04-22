// Integration audit script - Fixed for TS/Lint issues
// Run: bun run check-tools.ts (from v:\pankaj\navi\packages\navi)
import { MemorySearchTool } from './tools/memory-search.js';
import { BrowserTool } from './tools/browser.js';
import { CodeSandboxTool } from './tools/sandbox.js';
import { SendMessageTool } from './tools/send-message.js';
import { Kind } from './tools/tools.js';

const results: { name: string; status: 'PASS' | 'FAIL'; detail: string }[] = [];

function check(label: string, fn: () => void) {
  try {
    fn();
    results.push({ name: label, status: 'PASS', detail: 'OK' });
  } catch (e: any) {
    results.push({ name: label, status: 'FAIL', detail: e.message });
  }
}

// Instantiate with a mock message bus for checking schemas
const mockBus = {} as any;

check('MemorySearchTool integration', () => {
  const t = new MemorySearchTool(mockBus);
  if (t.name !== 'memory_search') throw new Error(`Wrong name: ${t.name}`);
  if (!t.schema.parametersJsonSchema) throw new Error('No schema');
});

check('BrowserTool integration', () => {
  const t = new BrowserTool(mockBus);
  if (t.name !== 'browser') throw new Error(`Wrong name: ${t.name}`);
  const s = t.schema.parametersJsonSchema as any;
  if (!s?.properties?.action) throw new Error('Missing action param');
  if (t.kind !== Kind.Execute) throw new Error(`Expected Execute, got ${t.kind}`);
});

check('CodeSandboxTool integration', () => {
  const t = new CodeSandboxTool(mockBus);
  if (t.name !== 'sandbox') throw new Error(`Wrong name: ${t.name}`);
  const s = t.schema.parametersJsonSchema as any;
  if (!s?.properties?.language || !s?.properties?.code) throw new Error('Missing params');
  if (t.kind !== Kind.Execute) throw new Error(`Expected Execute, got ${t.kind}`);
});

check('SendMessageTool integration', () => {
  const t = new SendMessageTool(mockBus);
  if (t.name !== 'send_message') throw new Error(`Wrong name: ${t.name}`);
  const s = t.schema.parametersJsonSchema as any;
  if (!s?.properties?.action || !s?.properties?.target || !s?.properties?.message) throw new Error('Missing params');
  const e: string[] = s?.properties?.action?.enum ?? [];
  if (!e.includes('send') || !e.includes('list')) throw new Error('Bad enum');
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('   Navi OpenClaw Integration Audit Results');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

let pass = 0, fail = 0;
for (const r of results) {
  const icon = r.status === 'PASS' ? '✅' : '❌';
  console.log(`  ${icon} ${r.name}`);
  if (r.status === 'FAIL') { console.log(`      ERROR: ${r.detail}`); fail++; } else { pass++; }
}
console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
else console.log('  Integration looks solid! 🚀\n');
