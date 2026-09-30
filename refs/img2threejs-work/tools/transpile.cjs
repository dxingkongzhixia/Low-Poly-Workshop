// Transpile the generated TypeScript factory to plain ES modules using Node's own
// type-stripping (Node >= 22.13). No external toolchain, no network.
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');

const src = process.argv[2];
const out = process.argv[3];
const code = fs.readFileSync(src, 'utf8');
let stripped;
try {
  stripped = stripTypeScriptTypes(code, { mode: 'strip', sourceMap: false });
} catch (err) {
  console.error('strip failed:', err.message);
  process.exit(1);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, stripped, 'utf8');
console.log('wrote', out, stripped.length, 'bytes');
