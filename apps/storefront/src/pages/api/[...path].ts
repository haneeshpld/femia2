import type { APIRoute } from 'astro';
import { apiFetch } from '../../lib/api.ts';

/** Same-origin proxy for browser islands → Core API. Admin routes are never reachable from the storefront. */
const ALLOWED = /^(catalog|cart|checkout|orders|newsletter|events|payments\/[a-z]+\/return)(\/|$)/;

export const ALL: APIRoute = async ({ params, request, url }) => {
  const path = params.path ?? '';
  if (!ALLOWED.test(path)) return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Not found' } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  const headers = new Headers();
  for (const h of ['content-type', 'accept']) { const v = request.headers.get(h); if (v) headers.set(h, v); }
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('cf-connecting-ip', ip);
  const res = await apiFetch(`/${path}${url.search}`, {
    method: request.method, headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
};
