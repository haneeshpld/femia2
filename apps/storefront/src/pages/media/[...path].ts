import type { APIRoute } from 'astro';
import { apiFetch } from '../../lib/api.ts';

/** Product photos served from the storefront origin (one less connection for LCP), edge-cached forever. */
export const GET: APIRoute = async ({ params, request }) => {
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const hit = await cache?.match(request);
  if (hit) return hit;
  const res = await apiFetch(`/media/${params.path}`);
  const out = new Response(res.body, { status: res.status, headers: res.headers });
  if (res.ok && cache) await cache.put(request, out.clone());
  return out;
};
