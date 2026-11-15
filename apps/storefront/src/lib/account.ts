import { json } from './http.ts';

/**
 * Shopper account helpers. The session itself lives in an HttpOnly cookie the browser can't read; the small
 * "signed in" hint below is only for showing the right header icon, never for access.
 */
export class AccountError extends Error {
  constructor(public status: number, public code: string, message: string, public fields: Record<string, string> = {}) { super(message); }
}

export async function acct<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { Accept: 'application/json', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  }).catch(() => null);
  if (!res) throw new AccountError(0, 'offline', 'We couldn’t reach Femia. Check your connection and try again.');
  const data = await json<any>(res).catch(() => null);
  if (!res.ok) {
    if (res.status === 401) setSignedIn(null);
    throw new AccountError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? 'Something went wrong. Please try again.', data?.error?.details?.fields ?? {});
  }
  return data as T;
}

const HINT = 'femia.account.v1';
export function setSignedIn(who: { name: string } | null) {
  try { if (who) localStorage.setItem(HINT, JSON.stringify({ name: who.name })); else localStorage.removeItem(HINT); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('femia:account'));
}
export function signedInHint(): { name: string } | null {
  try { return JSON.parse(localStorage.getItem(HINT) ?? 'null'); } catch { return null; }
}

/** Only follow same-site paths after sign-in (never an outside URL). */
export function safeNext(raw: string | null, fallback = '/account') {
  return raw && /^\/(?!\/)[\w\-/?=&%.]*$/.test(raw) && !raw.startsWith('/account/sign-in') ? raw : fallback;
}
