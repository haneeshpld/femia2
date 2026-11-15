// Move the shop's data (database + product photos + the master key that goes with them) between your laptop and
// any Cloudflare account, or from one account to another.
//
//   npm run data -- copy local clients/personal.json          your local shop → your test account
//   npm run data -- copy clients/personal.json clients/femia.json   test account → the shop's real account
//   npm run data -- export clients/personal.json                a backup folder in .release/<client>/
//   npm run data -- import .release/personal/export-… clients/femia.json
//
// Options: --replace   allow overwriting a target that already has products/orders (asks you to confirm)
//          --no-media  database only
// Each side uses its own token (the client's "tokenEnv"), so two accounts can be used in one copy.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { cfApi, loadClient, readJsonc, ROOT, secretsPath, wranglerEnv, writeClientConfig } from './lib.mjs';
import { listRemote, pushSecrets } from './secrets.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--') && !a.includes('=')));
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const pos = args.filter((a) => !a.startsWith('--'));
const API_DIR = join(ROOT, 'apps/api');
const LOCAL_STATE = opt('local-state') ?? join(ROOT, '.wrangler/state'); // --local-state lets tests use a scratch copy
const LOCAL_VARS = opt('local-vars') ?? join(API_DIR, '.dev.vars');
const EPHEMERAL = ['sessions', 'otp_codes', 'rate_limits', 'admin_signups']; // never carried over

/** 'local' or a client config. */
const side = (s) => (s === 'local' ? { local: true, name: 'local' } : { local: false, c: loadClient(s), name: loadClient(s).client });
const sh = (cmd, a, o = {}) => execFileSync(cmd, a, { cwd: API_DIR, encoding: 'utf8', stdio: o.quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'], ...o });

// ───────── database ─────────
function d1Json(s, sql) {
  const base = ['wrangler', 'd1', 'execute', 'DB', '--json', '--command', sql];
  const out = s.local
    ? sh('npx', [...base, '--local', '--persist-to', LOCAL_STATE], { quiet: true })
    : sh('npx', [...base, '--remote', '-c', writeClientConfig('api', s.c)], { env: wranglerEnv(s.c), quiet: true });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}
function d1File(s, file) {
  const base = ['wrangler', 'd1', 'execute', 'DB', '--file', file, '-y'];
  if (s.local) sh('npx', [...base, '--local', '--persist-to', LOCAL_STATE]);
  else sh('npx', [...base, '--remote', '-c', writeClientConfig('api', s.c)], { env: wranglerEnv(s.c) });
}
/** Split SQL into statements (quotes respected) and put all tables first, then data, so foreign keys always find their tables. */
function tablesFirst(sql) {
  const stmts = []; let cur = ''; let q = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    cur += ch;
    if (q) { if (ch === q) { if (sql[i + 1] === q) { cur += sql[++i]; } else q = null; } }
    else if (ch === '-' && sql[i + 1] === '-') { const end = sql.indexOf('\n', i); const stop = end === -1 ? sql.length : end; cur += sql.slice(i + 1, stop); i = stop - 1; }
    else if (ch === '/' && sql[i + 1] === '*') { const end = sql.indexOf('*/', i + 2); const stop = end === -1 ? sql.length : end + 2; cur += sql.slice(i + 1, stop); i = stop - 1; }
    else if (ch === "'" || ch === '"') q = ch;
    else if (ch === ';') { if (cur.trim()) stmts.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) stmts.push(cur.trim());
  // Rows go in parent-first order (live D1 checks each foreign key as it arrives), read from each table's REFERENCES.
  const tableOf = (st) => /^(?:CREATE TABLE(?: IF NOT EXISTS)?|INSERT INTO)\s+"?([\w]+)"?/i.exec(st)?.[1] ?? '';
  const parents = new Map();
  for (const st of stmts.filter((x) => /^CREATE TABLE/i.test(x))) {
    const t = tableOf(st);
    parents.set(t, new Set([...st.matchAll(/REFERENCES\s+"?(\w+)"?/gi)].map((m) => m[1]).filter((p) => p !== t)));
  }
  const level = new Map();
  const depth = (t, seen = new Set()) => {
    if (level.has(t)) return level.get(t);
    if (seen.has(t)) return 0; // cycle: let deferred checks handle it
    seen.add(t);
    const d = Math.max(0, ...[...(parents.get(t) ?? [])].map((p) => depth(p, seen) + 1));
    level.set(t, d);
    return d;
  };
  const rank = (st) => (/^PRAGMA/i.test(st) ? 0 : /^CREATE TABLE/i.test(st) ? 1 : /^INSERT/i.test(st) ? 2 : 3);
  return stmts.map((st, i) => ({ st, i, d: /^INSERT/i.test(st) ? depth(tableOf(st)) : 0 }))
    .sort((a, b) => rank(a.st) - rank(b.st) || a.d - b.d || a.i - b.i).map((x) => x.st).join('\n') + '\n';
}

function exportDb(s, out) {
  exportRaw(s, out);
  writeFileSync(out, tablesFirst(readFileSync(out, 'utf8')));
}
function exportRaw(s, out) {
  if (!s.local) {
    sh('npx', ['wrangler', 'd1', 'export', 'DB', '--remote', '-c', writeClientConfig('api', s.c), '--output', out, '-y'], { env: wranglerEnv(s.c) });
    return;
  }
  // `d1 export --local` reads <config dir>/.wrangler/state; point a scratch config at the project's local state.
  const proj = mkdtempSync(join(tmpdir(), 'femia-export-'));
  try {
    mkdirSync(join(proj, '.wrangler'), { recursive: true });
    symlinkSync(LOCAL_STATE, join(proj, '.wrangler', 'state'));
    const cfg = readJsonc(join(API_DIR, 'wrangler.jsonc'));
    delete cfg.$schema;
    cfg.main = join(API_DIR, cfg.main);
    writeFileSync(join(proj, 'wrangler.json'), JSON.stringify(cfg));
    sh(join(ROOT, 'node_modules/.bin/wrangler'), ['d1', 'export', 'DB', '--local', '-c', 'wrangler.json', '--output', out], { cwd: proj });
  } finally { rmSync(proj, { recursive: true, force: true }); }
}

// ───────── photos (R2) ─────────
const KEYS_SQL = 'SELECT key_base, sizes FROM media';
const mediaKeys = (rows) => rows.flatMap((r) => (JSON.parse(r.sizes || '[]')).map((w) => `${r.key_base}/${w}.webp`));

async function getObject(s, key, file) {
  if (s.local) {
    // Fast path: the running local API serves media; otherwise read the local bucket with wrangler.
    try {
      const res = await fetch(`http://localhost:8787/media/${key}`);
      if (res.ok) { writeFileSync(file, Buffer.from(await res.arrayBuffer())); return; }
    } catch { /* dev API not running */ }
    sh('npx', ['wrangler', 'r2', 'object', 'get', `femia-media/${key}`, '--local', '--persist-to', LOCAL_STATE, '--file', file], { quiet: true });
    return;
  }
  const res = await cfApi(s.c, `/accounts/${s.c.accountId}/r2/buckets/${s.c.r2.bucket}/objects/${key.split('/').map(encodeURIComponent).join('/')}`, { raw: true });
  if (!res.ok) throw new Error(`download ${key}: ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}
async function putObject(s, key, file) {
  if (s.local) {
    sh('npx', ['wrangler', 'r2', 'object', 'put', `femia-media/${key}`, '--local', '--persist-to', LOCAL_STATE, '--file', file, '--content-type', 'image/webp'], { quiet: true });
    return;
  }
  const res = await cfApi(s.c, `/accounts/${s.c.accountId}/r2/buckets/${s.c.r2.bucket}/objects/${key.split('/').map(encodeURIComponent).join('/')}`,
    { raw: true, method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: readFileSync(file) });
  if (!res.ok) {
    // fall back to wrangler if the REST endpoint refuses this token
    sh('npx', ['wrangler', 'r2', 'object', 'put', `${s.c.r2.bucket}/${key}`, '--remote', '-c', writeClientConfig('api', s.c), '--file', file, '--content-type', 'image/webp'], { env: wranglerEnv(s.c), quiet: true });
  }
}
async function pool(items, n, fn) {
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const it = items[i++]; await fn(it); done++; if (done % 20 === 0 || done === items.length) process.stdout.write(`\r  ${done}/${items.length} photos`); }
  }));
  if (items.length) process.stdout.write('\n');
}

// ───────── master key ─────────
const readKey = (file) => (existsSync(file) ? /^SECRETS_KEY=(\S+)/m.exec(readFileSync(file, 'utf8'))?.[1] ?? null : null);
const keyFile = (s) => (s.local ? LOCAL_VARS : secretsPath(s.c));
function writeKey(file, key) {
  let s = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (/^SECRETS_KEY=.*$/m.test(s)) s = s.replace(/^SECRETS_KEY=.*$/m, `SECRETS_KEY=${key}`);
  else s += `${s.endsWith('\n') || !s ? '' : '\n'}# Master key (passwords, saved gateway keys): travels with this data.\nSECRETS_KEY=${key}\n`;
  writeFileSync(file, s, { mode: 0o600 });
  chmodSync(file, 0o600);
}

// ───────── commands ─────────
async function doExport(from, dir) {
  mkdirSync(join(dir, 'media'), { recursive: true });
  console.log(`Exporting ${from.name} → ${dir.replace(ROOT, '')}`);
  exportDb(from, join(dir, 'db.sql'));
  const keys = flags.has('--no-media') ? [] : mediaKeys(d1Json(from, KEYS_SQL));
  await pool(keys, 6, async (k) => { const f = join(dir, 'media', k); mkdirSync(dirname(f), { recursive: true }); await getObject(from, k, f); });
  const key = readKey(keyFile(from));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ source: from.name, at: new Date().toISOString(), media: keys, secretsKey: key }, null, 2), { mode: 0o600 });
  console.log(`✓ Database and ${keys.length} photo files exported${key ? ' (with the master key: keep this folder private)' : ''}.`);
}

async function doImport(dir, to) {
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  if (!to.local && !to.c.d1.id) throw new Error(`Run provision first: npm run provision ${to.c.__path}`);
  console.log(`Importing ${m.source} → ${to.name}`);
  const tables = d1Json(to, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").map((r) => r.name);
  if (tables.length) {
    const has = (t) => tables.includes(t);
    const rows = d1Json(to, `SELECT ${['products', 'orders', 'customers', 'media'].map((t) => (has(t) ? `(SELECT COUNT(*) FROM ${t})` : '0')).join(' + ')}${has('users') ? " + (SELECT COUNT(*) FROM users WHERE password_hash IS NOT NULL)" : ''} AS n`)[0].n;
    if (rows > 0) {
      if (!flags.has('--replace')) throw new Error(`${to.name} already has data (${rows} products/orders/accounts/photos). Use --replace to overwrite it.`);
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ans = await rl.question(`This DELETES everything in ${to.name} and replaces it with ${m.source}'s data. Type "${to.name}" to continue: `);
      rl.close();
      if (ans.trim() !== to.name) throw new Error('Cancelled.');
    }
    // Drop tables that refer to others first (children before parents), so no table loses a parent it still points at.
    const edges = d1Json(to, "SELECT m.name AS child, p.\"table\" AS parent FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) p WHERE m.type = 'table'");
    const order = []; const left = new Set(tables);
    while (left.size) {
      const free = [...left].filter((t) => !edges.some((e) => e.parent === t && e.child !== t && left.has(e.child)));
      const pick = free.length ? free : [...left]; // a cycle: just go
      for (const t of pick) { order.push(t); left.delete(t); }
    }
    const drop = join(dir, 'drop.sql');
    writeFileSync(drop, ['PRAGMA defer_foreign_keys = TRUE;', ...order.map((t) => `DROP TABLE IF EXISTS "${t}";`)].join('\n') + '\n');
    d1File(to, drop);
  }
  d1File(to, join(dir, 'db.sql'));
  const clean = join(dir, 'clean.sql');
  writeFileSync(clean, EPHEMERAL.map((t) => `DELETE FROM ${t};`).join('\n') + '\n');
  d1File(to, clean);

  await pool(m.media ?? [], 6, (k) => putObject(to, k, join(dir, 'media', k)));

  if (m.secretsKey) {
    const kf = keyFile(to);
    const before = readKey(kf);
    if (before !== m.secretsKey) {
      writeKey(kf, m.secretsKey);
      console.log(`Master key copied into ${kf.replace(ROOT, '')} so existing passwords and saved Razorpay keys keep working.`);
      if (!to.local) {
        let exists = false;
        try { listRemote(to.c, writeClientConfig('api', to.c)); exists = true; } catch { /* not deployed yet */ }
        if (exists) pushSecrets(to.c, kf); else console.log('It will be pushed on the first deploy.');
      } else console.log('Restart `npm run dev:api` to use it.');
    }
  } else console.log('⚠ No master key came with this data: Admin passwords and saved gateway keys will need resetting.');
  console.log(`✓ ${to.name} now has ${m.source}'s data${(m.media ?? []).length ? ` and ${(m.media ?? []).length} photo files` : ''}. Everyone needs to sign in again.`);
}

const [cmd, a, b] = pos;
if (cmd === 'export') {
  const from = side(a);
  await doExport(from, opt('out') ?? join(ROOT, '.release', from.name, `export-${new Date().toISOString().replace(/[:.]/g, '-')}`));
} else if (cmd === 'import') {
  await doImport(a, side(b));
} else if (cmd === 'copy') {
  const from = side(a), to = side(b);
  if (from.name === to.name) throw new Error('Source and target are the same.');
  const dir = mkdtempSync(join(tmpdir(), 'femia-copy-'));
  try { await doExport(from, dir); await doImport(dir, to); } finally { rmSync(dir, { recursive: true, force: true }); }
} else {
  console.log('Usage:\n  npm run data -- copy <local|clients/x.json> <local|clients/y.json> [--replace] [--no-media]\n  npm run data -- export <local|clients/x.json> [--out=dir]\n  npm run data -- import <dir> <local|clients/y.json> [--replace]');
  process.exitCode = 1;
}
