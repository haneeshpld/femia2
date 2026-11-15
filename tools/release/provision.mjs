// One-time setup in a client's Cloudflare account: finds the account and workers.dev subdomain, creates the
// D1 database and R2 bucket, and makes sure the client has a master SECRETS_KEY in its (gitignored) secrets file.
// Usage: node tools/release/provision.mjs clients/<client>.json
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { cfApi, loadClient, run, saveClient, secretsPath, tokenFor } from './lib.mjs';

const c = loadClient(process.argv[2]);
tokenFor(c);

if (!c.accountId) {
  const accounts = await cfApi(c, '/accounts?per_page=50');
  if (accounts.length !== 1) throw new Error(`The token sees ${accounts.length} accounts. Put the right "accountId" in ${c.__path}:\n${accounts.map((a) => `  ${a.id}  ${a.name}`).join('\n')}`);
  c.accountId = accounts[0].id;
  console.log(`Account: ${accounts[0].name} (${c.accountId})`);
}
if (!c.workersDev && !(c.domains.store && c.domains.admin && c.domains.api)) {
  try {
    c.workersDev = (await cfApi(c, `/accounts/${c.accountId}/workers/subdomain`)).subdomain;
    console.log(`workers.dev subdomain: ${c.workersDev}`);
  } catch {
    throw new Error('This account has no workers.dev subdomain yet. Open Cloudflare → Workers & Pages once (it asks you to pick one), then run provision again.');
  }
}
saveClient(c);

const opts = { client: c, capture: true };
if (!c.d1.id) {
  const out = run('npx', ['wrangler', 'd1', 'create', c.d1.name], opts);
  const id = out.match(/"?database_id"?\W+([0-9a-f-]{36})/)?.[1];
  if (!id) throw new Error(`Could not read the D1 id from:\n${out}`);
  c.d1.id = id;
  saveClient(c);
  console.log(`D1 "${c.d1.name}" created: ${id}`);
}
try { run('npx', ['wrangler', 'r2', 'bucket', 'create', c.r2.bucket], opts); console.log(`R2 bucket "${c.r2.bucket}" created`); }
catch { console.log(`R2 bucket "${c.r2.bucket}" already exists`); }

// The master key peppers passwords and encrypts saved gateway keys. It lives with the client's secrets so the
// shop (and its data) can move to another account without everyone's logins breaking.
const sf = secretsPath(c);
const has = existsSync(sf) && /^SECRETS_KEY=\S+/m.test(readFileSync(sf, 'utf8'));
if (!has) {
  appendFileSync(sf, `\n# Master key (passwords, saved gateway keys). Keep it with this shop's data; never change it once live.\nSECRETS_KEY=${randomBytes(32).toString('base64')}\n`, { mode: 0o600 });
  console.log(`Generated a master SECRETS_KEY in ${sf.replace(process.cwd() + '/', '')}`);
}
console.log(`\n✓ ${c.client} is ready. Fill in the rest of ${sf.replace(process.cwd() + '/', '')}, then: npm run deploy ${c.__path}`);
