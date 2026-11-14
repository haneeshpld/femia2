// One-time setup in the CLIENT's Cloudflare account: D1 database, R2 bucket, Worker secrets.
// Usage: CLOUDFLARE_API_TOKEN=... node tools/release/provision.mjs clients/femia.json
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadClient, requireToken, run, writeClientConfig, ROOT } from './lib.mjs';
import { join } from 'node:path';

const file = process.argv[2];
const c = loadClient(file);
requireToken();
const opts = { accountId: c.accountId, capture: true };

if (!c.d1.id) {
  const out = run('npx', ['wrangler', 'd1', 'create', c.d1.name], opts);
  const id = out.match(/database_id\W+([0-9a-f-]{36})/)?.[1];
  if (!id) throw new Error(`Could not read the D1 id from:\n${out}`);
  c.d1.id = id;
  console.log(`D1 "${c.d1.name}" created: ${id}`);
}
try { run('npx', ['wrangler', 'r2', 'bucket', 'create', c.r2.bucket], opts); } catch { console.log(`R2 bucket "${c.r2.bucket}" already exists`); }
writeFileSync(file, JSON.stringify(c, null, 2) + '\n');

// Secrets: generated here, never written to disk.
const apiCfg = writeClientConfig('api', c);
const put = (name, value) => execFileSync('npx', ['wrangler', 'secret', 'put', name, '-c', apiCfg], { input: value, stdio: ['pipe', 'inherit', 'inherit'], cwd: join(ROOT, 'apps/api'), env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: c.accountId } });
put('SECRETS_KEY', randomBytes(32).toString('base64'));
console.log('\nSECRETS_KEY set. Now set the optional secrets interactively:');
console.log(`  npx wrangler secret put RESEND_API_KEY -c ${apiCfg}`);
console.log(`  npx wrangler secret put TELEGRAM_BOT_TOKEN -c ${apiCfg}`);
console.log('\nNext: create the Cloudflare Access application for', c.domains.admin, '(email one-time PIN), put its AUD in', file, 'then run deploy.');
void readFileSync;
