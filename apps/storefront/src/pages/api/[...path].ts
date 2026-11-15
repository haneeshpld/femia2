import type { APIRoute } from 'astro';
import { apiFetch } from '../../lib/api.ts';

/** Same-origin proxy for browser islands → Core API. Admin routes are never reachable from the storefront. */
const ALLOWED = /^(catalog|cart|checkout|orders|newsletter|events|payments\/[a-z]+\/return|auth\/customer|account)(\/|$)/;

export const ALL: APIRoute = async ({ params, request, url }) => {
  const path = params.path ?? '';
  if (!ALLOWED.test(path)) return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  const headers = new Headers();
  // cookie carries the shopper session; origin and user-agent feed the API's cross-site and device checks
  for (const h of ['content-type', 'accept', 'cookie', 'origin', 'user-agent']) { const v = request.headers.get(h); if (v) headers.set(h, v); }
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('cf-connecting-ip', ip);
  // Catalog reads the API marks cacheable (s-maxage) are served from the edge; stock, orders and writes never are.
  const cache = request.method === 'GET' && !/^(auth|account)/.test(path) ? (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default : undefined;
  const key = cache ? new Request(url.toString(), { method: 'GET' }) : undefined;
  if (cache && key) { const hit = await cache.match(key); if (hit) return hit; }
  const res = await apiFetch(`/${path}${url.search}`, {
    method: request.method, headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
  });
  const out = new Response(res.body, { status: res.status, headers: res.headers });
  const cc = out.headers.get('Cache-Control') ?? '';
  if (cache && key && out.status === 200 && /s-maxage=\d+/.test(cc) && !/no-store|private/.test(cc)) await cache.put(key, out.clone()).catch(() => {});
  return out;
};
