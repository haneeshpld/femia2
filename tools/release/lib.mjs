import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = new URL('../../', import.meta.url).pathname;
export const APPS = ['api', 'storefront', 'admin'];

export function loadClient(path) {
  if (!path || !existsSync(path)) throw new Error('Usage: <script> clients/<client>.json');
  const c = JSON.parse(readFileSync(path, 'utf8'));
  for (const k of ['client', 'accountId']) if (!c[k]) throw new Error(`clients config: "${k}" is required`);
  return c;
}

export function requireToken() {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Set CLOUDFLARE_API_TOKEN to the scoped token the client created for us (see docs/RELEASE.md).');
  }
}

/** Strip // and /* *\/ comments from wrangler.jsonc. */
export const readJsonc = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));

export function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', cwd: opts.cwd ?? ROOT, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: opts.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID } });
}

export function version() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  let sha = 'local';
  try { sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* no commits yet */ }
  return `${pkg}+${sha}`;
}

/** Per-client wrangler config generated next to each app (paths in "main" stay relative). */
export function writeClientConfig(app, c) {
  const base = readJsonc(join(ROOT, 'apps', app, 'wrangler.jsonc'));
  delete base.$schema;
  base.account_id = c.accountId;
  if (app === 'api') {
    base.d1_databases[0].database_id = c.d1.id;
    base.d1_databases[0].database_name = c.d1.name;
    base.r2_buckets[0].bucket_name = c.r2.bucket;
    base.routes = [{ pattern: c.domains.api, custom_domain: true }];
    base.vars = {
      ...base.vars, ENVIRONMENT: 'production', PUBLIC_SITE_URL: `https://${c.domains.store}`, ADMIN_URL: `https://${c.domains.admin}`,
      ACCESS_TEAM_DOMAIN: c.access.teamDomain, ACCESS_AUD: c.access.aud, EMAIL_FROM: c.email.from,
    };
  }
  if (app === 'storefront') {
    base.routes = [{ pattern: c.domains.store, custom_domain: true }, { pattern: `www.${c.domains.store}`, custom_domain: true }];
    base.vars = { ...base.vars, PUBLIC_SITE_URL: `https://${c.domains.store}` };
  }
  if (app === 'admin') base.routes = [{ pattern: c.domains.admin, custom_domain: true }];
  const out = join(ROOT, 'apps', app, `wrangler.${c.client}.json`);
  writeFileSync(out, JSON.stringify(base, null, 2));
  return out;
}

export function history(c, entry) {
  const dir = join(ROOT, '.release', c.client);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'history.json');
  const list = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
  if (entry) { list.unshift(entry); writeFileSync(f, JSON.stringify(list, null, 2)); }
  return list;
}
