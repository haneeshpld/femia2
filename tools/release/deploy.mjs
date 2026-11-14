// Versioned deploy of api → storefront → admin into the client's account.
// Usage: CLOUDFLARE_API_TOKEN=... node tools/release/deploy.mjs clients/femia.json [--skip-tests] [--only=api,storefront]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPS, history, loadClient, requireToken, ROOT, run, version, writeClientConfig } from './lib.mjs';

const args = process.argv.slice(2);
const c = loadClient(args.find((a) => a.endsWith('.json')));
requireToken();
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',') ?? APPS;
const v = version();
const opts = { accountId: c.accountId };
for (const k of ['id']) if (!c.d1[k]) throw new Error('Run provision first: D1 id missing');
if (!c.access.aud) throw new Error('Set access.aud (Cloudflare Access application AUD tag) before deploying');

console.log(`\nDeploying ${c.client} ${v} (${only.join(', ')})`);
if (!args.includes('--skip-tests')) { run('npm', ['run', 'typecheck']); run('npm', ['test']); }

const cfg = Object.fromEntries(APPS.map((a) => [a, writeClientConfig(a, c)]));

if (only.includes('api')) {
  run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote', '-c', cfg.api], { ...opts, cwd: join(ROOT, 'apps/api') });
  // Register the storefront manifest so Admin forms and API validation match this release.
  const manifest = readFileSync(join(ROOT, 'apps/storefront/site.manifest.json'), 'utf8').replace(/'/g, "''");
  const sql = join(ROOT, '.release', c.client, 'manifest.sql');
  history(c);
  writeFileSync(sql, `INSERT INTO settings (key, value, updated_by) VALUES ('site_manifest', '${manifest}', 'release ${v}') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');\n`);
  run('npx', ['wrangler', 'd1', 'execute', 'DB', '--remote', '-c', cfg.api, '--file', sql], { ...opts, cwd: join(ROOT, 'apps/api') });
  run('npx', ['wrangler', 'deploy', '-c', cfg.api, '--tag', v, '--message', `release ${v}`], { ...opts, cwd: join(ROOT, 'apps/api') });
}
if (only.includes('storefront')) {
  process.env.PUBLIC_SITE_URL = `https://${c.domains.store}`;
  run('npx', ['astro', 'build'], { cwd: join(ROOT, 'apps/storefront') });
  run('npx', ['wrangler', 'deploy', '-c', cfg.storefront, '--tag', v, '--message', `release ${v}`], { ...opts, cwd: join(ROOT, 'apps/storefront') });
}
if (only.includes('admin')) {
  process.env.VITE_STOREFRONT_URL = `https://${c.domains.store}`;
  run('npx', ['vite', 'build'], { cwd: join(ROOT, 'apps/admin') });
  run('npx', ['wrangler', 'deploy', '-c', cfg.admin, '--tag', v, '--message', `release ${v}`], { ...opts, cwd: join(ROOT, 'apps/admin') });
}
history(c, { version: v, apps: only, at: new Date().toISOString() });
console.log(`\n✓ ${c.client} is on ${v}. Roll back with: node tools/release/rollback.mjs ${args.find((a) => a.endsWith('.json'))}`);
