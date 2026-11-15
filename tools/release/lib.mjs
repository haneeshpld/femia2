import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = new URL('../../', import.meta.url).pathname;
export const APPS = ['api', 'storefront', 'admin'];

/**
 * A "client" is one Cloudflare account Femia is deployed to: clients/<name>.json (+ clients/<name>.secrets.env).
 * Your personal test account and the shop's real account are just two clients; moving between them is
 * `npm run client:new`, `provision`, `data copy`, `deploy`. See docs/RELEASE.md.
 *
 * {
 *   "client": "personal",            file name / label
 *   "accountId": "",                 found automatically by provision when the token sees one account
 *   "environment": "staging",        "staging" (test site: hidden from search engines) or "production"
 *   "prefix": "femia",               Worker names: <prefix>-api, <prefix>-storefront, <prefix>-admin
 *   "workersDev": "",                your <name>.workers.dev subdomain; found by provision; used when no domains
 *   "domains": { "store": "", "admin": "", "api": "" },   optional custom domains (on a zone in this account)
 *   "tokenEnv": "CLOUDFLARE_API_TOKEN",                   env var holding THIS account's API token
 *   "d1": { "name": "femia", "id": "" }, "r2": { "bucket": "femia-media" }, "email": { "from": "…" }
 * }
 */
export function loadClient(path) {
  if (!path || !existsSync(path)) throw new Error('Usage: <script> clients/<client>.json   (create one with: npm run client:new <name>)');
  const c = JSON.parse(readFileSync(path, 'utf8'));
  if (!c.client) throw new Error(`${path}: "client" is required`);
  c.prefix ||= 'femia';
  c.environment ||= 'production';
  c.domains ||= {};
  c.d1 ||= { name: c.prefix, id: '' };
  c.r2 ||= { bucket: `${c.prefix}-media` };
  c.email ||= { from: 'Femia <orders@example.com>' };
  c.tokenEnv ||= 'CLOUDFLARE_API_TOKEN';
  c.__path = path;
  return c;
}

export function saveClient(c) {
  const { __path, ...data } = c;
  writeFileSync(__path, JSON.stringify(data, null, 2) + '\n');
}

export const secretsPath = (c) => join(ROOT, 'clients', `${c.client}.secrets.env`);

/**
 * How we talk to this client's account: an API token in the client's env var (so two accounts can be used at
 * once), or else your own `npx wrangler login` session.
 */
let oauth;
export function authFor(c) {
  const t = process.env[c.tokenEnv];
  if (t) return { token: t, oauth: false };
  if (oauth === undefined) {
    try {
      const out = execFileSync('npx', ['wrangler', 'auth', 'token', '--json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      oauth = JSON.parse(out.slice(out.indexOf('{'))).token || null;
    } catch { oauth = null; }
  }
  if (!oauth) throw new Error(`Sign in with \`npx wrangler login\`, or set ${c.tokenEnv} to an API token for the "${c.client}" account (see docs/RELEASE.md).`);
  return { token: oauth, oauth: true };
}
export const tokenFor = (c) => authFor(c).token;
/** Back-compat for scripts that only need "some token is set". */
export function requireToken(c) { return c ? tokenFor(c) : process.env.CLOUDFLARE_API_TOKEN; }

// With `wrangler login`, wrangler uses (and refreshes) its own session; with a token, we hand it over.
export const wranglerEnv = (c) => {
  const a = authFor(c);
  return { ...process.env, ...(a.oauth ? {} : { CLOUDFLARE_API_TOKEN: a.token }), ...(c.accountId ? { CLOUDFLARE_ACCOUNT_ID: c.accountId } : {}) };
};

/** Strip // and /* *\/ comments from wrangler.jsonc. */
export const readJsonc = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));

export function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, {
    stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', cwd: opts.cwd ?? ROOT,
    env: opts.client ? wranglerEnv(opts.client) : { ...process.env, ...(opts.accountId ? { CLOUDFLARE_ACCOUNT_ID: opts.accountId } : {}) },
  });
}

export function version() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  let sha = 'local';
  try { sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* no commits yet */ }
  return `${pkg}+${sha}`;
}

export const workerName = (c, app) => `${c.prefix}-${app}`;

/** Public addresses: custom domains when set, otherwise <worker>.<subdomain>.workers.dev. */
export function urls(c) {
  const dev = (app) => {
    if (!c.workersDev) throw new Error(`${c.__path}: set "workersDev" (your workers.dev subdomain; provision fills it in) or custom "domains"`);
    return `https://${workerName(c, app)}.${c.workersDev}.workers.dev`;
  };
  return {
    store: c.domains.store ? `https://${c.domains.store}` : dev('storefront'),
    admin: c.domains.admin ? `https://${c.domains.admin}` : dev('admin'),
    api: c.domains.api ? `https://${c.domains.api}` : dev('api'),
  };
}

/** Per-client wrangler config generated next to each app (paths in "main" stay relative). */
export function writeClientConfig(app, c) {
  const base = readJsonc(join(ROOT, 'apps', app, 'wrangler.jsonc'));
  delete base.$schema;
  const u = urls(c);
  base.name = workerName(c, app);
  if (c.accountId) base.account_id = c.accountId;
  const domain = c.domains[app === 'storefront' ? 'store' : app];
  base.workers_dev = !domain;
  base.preview_urls = false;
  if (base.services) base.services = base.services.map((s) => (s.service === 'femia-api' ? { ...s, service: workerName(c, 'api') } : s));
  if (app === 'api') {
    base.d1_databases[0].database_id = c.d1.id;
    base.d1_databases[0].database_name = c.d1.name;
    base.r2_buckets[0].bucket_name = c.r2.bucket;
    if (domain) base.routes = [{ pattern: domain, custom_domain: true }];
    base.vars = { ...base.vars, ENVIRONMENT: c.environment, PUBLIC_SITE_URL: u.store, ADMIN_URL: u.admin, API_URL: u.api, EMAIL_FROM: c.email.from };
  }
  if (app === 'storefront') {
    if (domain) base.routes = [{ pattern: domain, custom_domain: true }, ...(c.domains.www === false ? [] : [{ pattern: `www.${domain}`, custom_domain: true }])];
    base.vars = { ...base.vars, PUBLIC_SITE_URL: u.store, ...(c.environment === 'staging' ? { NOINDEX: '1' } : {}) };
  }
  if (app === 'admin' && domain) base.routes = [{ pattern: domain, custom_domain: true }];
  const out = join(ROOT, 'apps', app, `wrangler.${c.client}.json`);
  writeFileSync(out, JSON.stringify(base, null, 2));
  return out;
}

/**
 * The storefront build writes its own Worker config (dist/server/wrangler.json). Apply this client's name,
 * account, addresses and API binding to it, and deploy that.
 */
export function patchStorefrontBuild(c) {
  const file = join(ROOT, 'apps/storefront/dist/server/wrangler.json');
  const built = JSON.parse(readFileSync(file, 'utf8'));
  const mine = JSON.parse(readFileSync(writeClientConfig('storefront', c), 'utf8'));
  for (const k of ['name', 'account_id', 'workers_dev', 'preview_urls', 'routes', 'services', 'vars']) {
    if (mine[k] === undefined) delete built[k]; else built[k] = mine[k];
  }
  delete built.topLevelName; built.topLevelName = mine.name;
  writeFileSync(file, JSON.stringify(built));
  return file;
}

/** Cloudflare REST API with this client's token. */
export async function cfApi(c, path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { Authorization: `Bearer ${tokenFor(c)}`, ...(init.headers ?? {}) } });
  if (init.raw) return res;
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) throw new Error(`Cloudflare API ${path}: ${res.status} ${(j.errors ?? []).map((e) => e.message).join('; ')}`);
  return j.result;
}

export function history(c, entry) {
  const dir = join(ROOT, '.release', c.client);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'history.json');
  const list = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
  if (entry) { list.unshift(entry); writeFileSync(f, JSON.stringify(list, null, 2)); }
  return list;
}
