import type { Env } from '../env.ts';
import { decrypt, encrypt } from '../lib/crypto.ts';
import { first } from '../lib/db.ts';
import { HttpError } from '../lib/http.ts';
import type { PaymentProvider } from './provider.ts';
import { razorpay } from './razorpay.ts';

export const PROVIDERS: Record<string, PaymentProvider<any>> = { razorpay };

export function getProvider(id: string): PaymentProvider<Record<string, string>> {
  const p = PROVIDERS[id];
  if (!p) throw new HttpError(400, 'gateway_unsupported', `Payment gateway "${id}" is not available yet`);
  return p;
}

const secretKey = (provider: string) => `gateway.${provider}`;

async function storedKeys(env: Env, provider: string): Promise<Record<string, string>> {
  if (!env.SECRETS_KEY) return {};
  const row = await first<{ iv: string; ciphertext: string }>(env.DB, 'SELECT iv, ciphertext FROM secrets WHERE key = ?', secretKey(provider));
  return row ? (JSON.parse(await decrypt(env.SECRETS_KEY, row.iv, row.ciphertext)) as Record<string, string>) : {};
}

/**
 * Gateway keys: Worker secrets (e.g. RAZORPAY_KEY_SECRET, pushed by the deploy) first, then keys saved in
 * Admin → Settings (encrypted in D1). Null until the provider's required keys are all there.
 */
export async function getGatewayKeys(env: Env, provider: string): Promise<Record<string, string> | null> {
  const p = PROVIDERS[provider];
  if (!p) return null;
  const fromEnv = Object.fromEntries(Object.entries(p.envKeys(env)).filter(([, v]) => !!v)) as Record<string, string>;
  const keys = { ...(await storedKeys(env, provider)), ...fromEnv };
  const required = p.keyFields.filter((f) => f.id !== 'webhookSecret').map((f) => f.id);
  return required.every((k) => keys[k]) ? keys : null;
}

/** Where each key comes from, for the Admin settings screen. Values are never returned. */
export async function gatewayKeySources(env: Env, provider: string) {
  const p = PROVIDERS[provider];
  if (!p) return {};
  const fromEnv = p.envKeys(env) as Record<string, string | undefined>;
  const stored = await storedKeys(env, provider);
  return Object.fromEntries(p.keyFields.map((f) => [f.id, fromEnv[f.id] ? 'secret' : stored[f.id] ? 'admin' : null])) as Record<string, 'secret' | 'admin' | null>;
}

export async function putGatewayKeysStatement(env: Env, provider: string, keys: Record<string, string>, actor: string) {
  if (!env.SECRETS_KEY) throw new HttpError(500, 'secrets_unconfigured', 'SECRETS_KEY is not set on the API worker');
  const { iv, ciphertext } = await encrypt(env.SECRETS_KEY, JSON.stringify(keys));
  return env.DB.prepare(
    `INSERT INTO secrets (key, iv, ciphertext, updated_by, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET iv = excluded.iv, ciphertext = excluded.ciphertext, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(secretKey(provider), iv, ciphertext, actor, new Date().toISOString());
}

export { upiUri } from '@femia/contracts';
