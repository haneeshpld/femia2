import { defineMiddleware } from 'astro:middleware';

/**
 * Edge HTML cache. Pages that declare `Cache-Control: … s-maxage=N` (home, shop, product, collections, static
 * pages) are stored in Cloudflare's cache for N seconds, so repeat visits skip the 3–5 API sub-requests a render
 * needs. Personal pages (checkout, order, track, search, preview) send `no-store` and are never cached; cart and
 * wishlist live in the browser, so cached HTML is identical for everyone. Content edits show within a minute.
 */
const STORE_HEADER = 'x-femia-edge';

export const onRequest = defineMiddleware(async (ctx, next) => {
  const req = ctx.request;
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const path = new URL(req.url).pathname;
  if (import.meta.env.DEV || !cache || req.method !== 'GET' || path.startsWith('/api/') || path.startsWith('/media/') || path.startsWith('/_')) {
    return next();
  }
  // Key on the URL only: cookies and client headers never change the HTML.
  const key = new Request(req.url, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
    res.headers.set(STORE_HEADER, 'hit');
    return res;
  }
  const res = await next();
  const cc = res.headers.get('Cache-Control') ?? '';
  const sMax = /s-maxage=(\d+)/.exec(cc)?.[1];
  if (res.status !== 200 || !sMax || /no-store|private/.test(cc) || res.headers.has('Set-Cookie')) return res;
  const stored = new Response(res.clone().body, res);
  stored.headers.set('Cache-Control', `public, max-age=${sMax}`); // the edge entry's lifetime
  const put = cache.put(key, stored).catch(() => {});
  const waitUntil = (ctx.locals as { cfContext?: { waitUntil(p: Promise<unknown>): void } }).cfContext?.waitUntil;
  if (waitUntil) waitUntil.call((ctx.locals as { cfContext: object }).cfContext, put); else await put;
  res.headers.set(STORE_HEADER, 'miss');
  return res;
});
