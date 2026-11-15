export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
  get fields(): Record<string, string> { return this.details?.fields ?? {}; }
}

/** All admin calls go through /api (proxied to the Core API). */
export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: { Accept: 'application/json', ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // only a lost session (not a wrong password on the sign-in screen) sends you back to sign in
    if (res.status === 401 && data?.error?.code === 'unauthenticated' && path !== '/admin/me') window.dispatchEvent(new Event('femia:unauthenticated'));
    throw new ApiError(res.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `Something went wrong (${res.status})`, data?.error?.details);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, json?: unknown) => api<T>(p, { method: 'POST', json: json ?? {} });
export const put = <T = any>(p: string, json: unknown) => api<T>(p, { method: 'PUT', json });
export const patch = <T = any>(p: string, json: unknown) => api<T>(p, { method: 'PATCH', json });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });
