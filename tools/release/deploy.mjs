// Versioned deploy of api → storefront → admin into one client's Cloudflare account.
// Usage: node tools/release/deploy.mjs clients/<client>.json [--skip-tests] [--only=api,storefront]
// The API token comes from the env var named by the client's "tokenEnv" (default CLOUDFLARE_API_TOKEN).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPS, history, loadClient, patchStorefrontBuild, ROOT, run, secretsPath, tokenFor, urls, version, writeClientConfig } from './lib.mjs';
import { checkRemote, pushSecrets } from './secrets.mjs';

const args = process.argv.slice(2);
const c = loadClient(args.find((a) => a.endsWith('.json')));
tokenFor(c);
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',') ?? APPS;
const v = version();
if (!c.accountId || !c.d1.id) throw new Error(`Run provision first: npm run provision ${c.__path}`);
const u = urls(c);
const opts = { client: c };

console.log(`\nDeploying ${c.client} (${c.environment}) ${v}: ${only.join(', ')}`);
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
  // Worker secrets from clients/<client>.secrets.env (master key, Razorpay, Resend…), never from the repo.
  pushSecrets(c, secretsPath(c));
  if (checkRemote(c).length) throw new Error(`Required API secrets are missing (see above). Add them to ${secretsPath(c)} and deploy again.`);
}
if (only.includes('storefront')) {
  process.env.PUBLIC_SITE_URL = u.store;
  run('npx', ['astro', 'build'], { cwd: join(ROOT, 'apps/storefront') });
  const built = patchStorefrontBuild(c);
  run('npx', ['wrangler', 'deploy', '-c', built, '--tag', v, '--message', `release ${v}`], { ...opts, cwd: join(ROOT, 'apps/storefront') });
}
if (only.includes('admin')) {
  process.env.VITE_STOREFRONT_URL = u.store;
  run('npx', ['vite', 'build'], { cwd: join(ROOT, 'apps/admin') });
  run('npx', ['wrangler', 'deploy', '-c', cfg.admin, '--tag', v, '--message', `release ${v}`], { ...opts, cwd: join(ROOT, 'apps/admin') });
}
history(c, { version: v, apps: only, at: new Date().toISOString() });
console.log(`
✓ ${c.client} is on ${v}
  Shop:   ${u.store}${c.environment === 'staging' ? '   (test site: hidden from search engines)' : ''}
  Admin:  ${u.admin}
  API:    ${u.api}
  Razorpay webhook URL: ${u.api}/payments/webhook/razorpay
Roll back with: node tools/release/rollback.mjs ${c.__path}`);
