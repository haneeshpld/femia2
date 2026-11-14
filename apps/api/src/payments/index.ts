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

export async function getGatewayKeys(env: Env, provider: string): Promise<Record<string, string> | null> {
  if (!env.SECRETS_KEY) return null;
  const row = await first<{ iv: string; ciphertext: string }>(env.DB, 'SELECT iv, ciphertext FROM secrets WHERE key = ?', secretKey(provider));
  if (!row) return null;
  return JSON.parse(await decrypt(env.SECRETS_KEY, row.iv, row.ciphertext)) as Record<string, string>;
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
