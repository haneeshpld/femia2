// Roll every Worker back to its previous version. D1 migrations are additive-only by policy, so code rollback is safe.
// Usage: CLOUDFLARE_API_TOKEN=... node tools/release/rollback.mjs clients/femia.json [--only=storefront]
import { join } from 'node:path';
import { APPS, loadClient, requireToken, ROOT, run, writeClientConfig } from './lib.mjs';

const args = process.argv.slice(2);
const c = loadClient(args.find((a) => a.endsWith('.json')));
requireToken();
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',') ?? APPS;
for (const app of [...only].reverse()) {
  const cfg = writeClientConfig(app, c);
  run('npx', ['wrangler', 'rollback', '-c', cfg, '--message', 'rollback', '-y'], { accountId: c.accountId, cwd: join(ROOT, 'apps', app) });
}
console.log('\n✓ Rolled back. Check the site, then fix forward with a new release.');
