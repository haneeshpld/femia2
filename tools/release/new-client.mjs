// Create a deploy target (one Cloudflare account): clients/<name>.json + clients/<name>.secrets.env (gitignored).
// Usage: node tools/release/new-client.mjs <name> [--production] [--from=<other client>] [--token-env=CF_TOKEN_<NAME>]
//   --from    copy the other client's secrets (Razorpay, Resend, owner email AND the master SECRETS_KEY),
//             which is what you want when moving the shop and its data to a new account
import { copyFileSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--'));
if (!name || !/^[a-z][a-z0-9-]{1,30}$/.test(name)) throw new Error('Usage: npm run client:new <name>   (lower-case letters, numbers, dashes)');
const from = args.find((a) => a.startsWith('--from='))?.slice(7);
const production = args.includes('--production');
const tokenEnv = args.find((a) => a.startsWith('--token-env='))?.slice(12) ?? 'CLOUDFLARE_API_TOKEN';
const file = join(ROOT, 'clients', `${name}.json`);
const secrets = join(ROOT, 'clients', `${name}.secrets.env`);
if (existsSync(file)) throw new Error(`${file} already exists`);

const config = {
  client: name,
  accountId: '',
  environment: production ? 'production' : 'staging',
  prefix: 'femia',
  workersDev: '',
  domains: { store: '', admin: '', api: '' },
  tokenEnv,
  d1: { name: 'femia', id: '' },
  r2: { bucket: 'femia-media' },
  email: { from: 'Femia <orders@example.com>' },
};
writeFileSync(file, JSON.stringify(config, null, 2) + '\n');

if (from) {
  const src = join(ROOT, 'clients', `${from}.secrets.env`);
  if (!existsSync(src)) throw new Error(`${src} not found`);
  copyFileSync(src, secrets);
} else if (!existsSync(secrets)) {
  const example = readFileSync(join(ROOT, 'clients', 'femia.secrets.example.env'), 'utf8');
  writeFileSync(secrets, example.replace(/^# Copy to .*\n(#.*\n)*/, `# Secrets for "${name}". Never commit. Pushed on every deploy.\n`));
}
chmodSync(secrets, 0o600);

console.log(`Created ${file.replace(ROOT, '')} (${config.environment}) and ${secrets.replace(ROOT, '')}.`);
console.log(`\nNext:
  1. Put this account's API token in ${tokenEnv} (permissions in docs/RELEASE.md).
  2. Fill in ${secrets.replace(ROOT, '')}${from ? ` (copied from "${from}", including the master key)` : ''}.
  3. npm run provision clients/${name}.json        # finds the account, creates the database and photo storage
  4. npm run data -- copy local clients/${name}.json  # optional: your local products, photos, orders and team
  5. npm run deploy clients/${name}.json`);
