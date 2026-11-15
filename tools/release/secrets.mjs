// Push the API Worker's secrets to Cloudflare from clients/<client>.secrets.env (gitignored).
// Usage: node tools/release/secrets.mjs clients/<client>.json [--check] [--file=path]   (token: the client's tokenEnv)
//   --check   only list which secrets are set on Cloudflare (names only) and what's missing
// Values are never printed. They go to `wrangler secret bulk` through a private temp file that's deleted at once.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadClient, ROOT, secretsPath, tokenFor, wranglerEnv, writeClientConfig } from './lib.mjs';

/** Secrets the API understands. Anything else in the file is refused, to catch typos. */
export const KNOWN = {
  SECRETS_KEY: { check: (v) => { try { return Buffer.from(v, 'base64').length === 32 || 'must be 32 random bytes, base64'; } catch { return 'must be base64'; } } },
  RAZORPAY_KEY_ID: { check: (v) => /^rzp_(test|live)_[A-Za-z0-9]{8,}$/.test(v) || 'should look like rzp_test_… or rzp_live_…' },
  RAZORPAY_KEY_SECRET: { check: (v) => v.length >= 16 || 'looks too short' },
  RAZORPAY_WEBHOOK_SECRET: { check: (v) => v.length >= 16 || 'use at least 16 characters' },
  RESEND_API_KEY: { check: (v) => v.startsWith('re_') || 'should start with re_' },
  OWNER_EMAIL: { check: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'not an email address' },
  FIXED_OTP_CODE: { check: (v) => (/^\d{6}$/.test(v) && !/^(\d)\1{5}$|^123456$|^654321$/.test(v)) || 'use 6 digits that are hard to guess' },
  TELEGRAM_BOT_TOKEN: { check: (v) => /^\d+:[\w-]{20,}$/.test(v) || 'should look like 123456:ABC…' },
};
const REQUIRED = ['SECRETS_KEY'];
// OWNER_EMAIL matters for a brand-new empty shop (the first owner); copied data already has its owner.
const RECOMMENDED = ['OWNER_EMAIL', 'RESEND_API_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'];

export function parseEnvFile(path) {
  const out = {};
  readFileSync(path, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const m = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(t);
    if (!m) throw new Error(`${path}:${i + 1}: expected NAME=value`);
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v) out[m[1]] = v;
  });
  return out;
}

export function validate(secrets) {
  const problems = [];
  for (const [k, v] of Object.entries(secrets)) {
    if (!KNOWN[k]) problems.push(`${k} isn't a secret the API uses (typo?)`);
    else { const ok = KNOWN[k].check(v); if (ok !== true) problems.push(`${k} ${ok}`); }
  }
  if (!!secrets.RAZORPAY_KEY_ID !== !!secrets.RAZORPAY_KEY_SECRET) problems.push('set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET together');
  return problems;
}


export function listRemote(c, cfg) {
  const out = execFileSync('npx', ['wrangler', 'secret', 'list', '-c', cfg, '--format', 'json'], { cwd: join(ROOT, 'apps/api'), env: wranglerEnv(c), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  return JSON.parse(out.slice(out.indexOf('['))).map((s) => s.name);
}

/** Upload secrets for the client's API Worker. Returns the names pushed. */
export function pushSecrets(c, file, { quiet = false } = {}) {
  if (!existsSync(file)) { if (!quiet) console.log(`No ${file}; skipping secrets.`); return []; }
  tokenFor(c);
  const secrets = parseEnvFile(file);
  const problems = validate(secrets);
  if (problems.length) throw new Error(`Fix ${file} first:\n  - ${problems.join('\n  - ')}`);
  if (secrets.RAZORPAY_KEY_ID?.startsWith('rzp_test_')) console.log('⚠ Razorpay is in TEST mode: shoppers can only pay with test cards. Swap in rzp_live_ keys to take real payments.');
  const names = Object.keys(secrets);
  if (!names.length) { console.log('No secrets with values to push.'); return []; }
  const cfg = writeClientConfig('api', c);
  const dir = mkdtempSync(join(tmpdir(), 'femia-secrets-'));
  const tmp = join(dir, 'secrets.json');
  try {
    writeFileSync(tmp, JSON.stringify(secrets), { mode: 0o600 });
    execFileSync('npx', ['wrangler', 'secret', 'bulk', tmp, '-c', cfg], { cwd: join(ROOT, 'apps/api'), env: wranglerEnv(c), stdio: ['ignore', 'ignore', 'inherit'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`✓ ${names.length} secret${names.length === 1 ? '' : 's'} set on ${c.client} API: ${names.join(', ')}`);
  return names;
}

export function checkRemote(c) {
  const cfg = writeClientConfig('api', c);
  const have = new Set(listRemote(c, cfg));
  const missing = REQUIRED.filter((n) => !have.has(n));
  const later = RECOMMENDED.filter((n) => !have.has(n));
  console.log(`Secrets on ${c.client} API: ${[...have].sort().join(', ') || '(none)'}`);
  if (later.length) console.log(`Not set yet (recommended): ${later.join(', ')}`);
  if (missing.length) console.log(`✗ Missing (required): ${missing.join(', ')}`);
  return missing;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const c = loadClient(args.find((a) => a.endsWith('.json')));
  tokenFor(c);
  const file = args.find((a) => a.startsWith('--file='))?.slice(7) ?? secretsPath(c);
  if (!args.includes('--check')) pushSecrets(c, file);
  process.exitCode = checkRemote(c).length ? 1 : 0;
}
