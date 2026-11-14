import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toCssVariables } from '../src/tokens.ts';

const out = fileURLToPath(new URL('../tokens.css', import.meta.url));
const css = toCssVariables();
if (process.argv.includes('--check')) {
  const current = readFileSync(out, 'utf8');
  if (current !== css) { console.error('tokens.css is stale: run npm run build -w @femia/tokens'); process.exit(1); }
  console.log('tokens.css up to date');
} else {
  writeFileSync(out, css);
  console.log('wrote tokens.css');
}
