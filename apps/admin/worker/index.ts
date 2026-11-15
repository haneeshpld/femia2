/// <reference types="@cloudflare/workers-types" />
interface Env { API: Fetcher; ASSETS: Fetcher }

/**
 * Admin Studio edge worker: serves the app and proxies /api to the Core API. Sign-in (password + emailed code)
 * and every permission check happen in the API; this only forwards the session cookie and the browser's Origin.
 */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {
      const path = url.pathname.startsWith('/api/') ? url.pathname.slice(4) : url.pathname;
      if (url.pathname.startsWith('/api/') && !/^\/(admin|auth\/admin|media|catalog|cart\/quote|settings\/public|content\/published)(\/|$)/.test(path)) {
        return new Response('Not found', { status: 404 });
      }
      const headers = new Headers();
      for (const h of ['content-type', 'accept', 'cookie', 'origin', 'user-agent', 'cf-connecting-ip']) { const v = req.headers.get(h); if (v) headers.set(h, v); }
      return env.API.fetch(new Request(`https://api.internal${path}${url.search}`, { method: req.method, headers, body: req.body }));
    }
    // Admin can't be framed by another site (clickjacking) and never leaks its URLs to other sites.
    const res = await env.ASSETS.fetch(req);
    const out = new Response(res.body, res);
    out.headers.set('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
    out.headers.set('X-Frame-Options', 'DENY');
    out.headers.set('Referrer-Policy', 'same-origin');
    out.headers.set('X-Content-Type-Options', 'nosniff');
    out.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), payment=()');
    return out;
  },
} satisfies ExportedHandler<Env>;
