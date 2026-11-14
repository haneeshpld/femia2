/// <reference types="@cloudflare/workers-types" />
interface Env { API: Fetcher; ASSETS: Fetcher }

/**
 * Admin Studio edge worker. Access has already authenticated the visitor; we forward the Access JWT
 * so the API verifies it again (defence in depth) and maps the email to a role.
 */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {
      const path = url.pathname.startsWith('/api/') ? url.pathname.slice(4) : url.pathname;
      if (url.pathname.startsWith('/api/') && !/^\/(admin|media|catalog|cart\/quote|settings\/public|content\/published)(\/|$)/.test(path)) {
        return new Response('Not found', { status: 404 });
      }
      const headers = new Headers();
      for (const h of ['content-type', 'accept', 'cf-access-jwt-assertion']) { const v = req.headers.get(h); if (v) headers.set(h, v); }
      return env.API.fetch(new Request(`https://api.internal${path}${url.search}`, { method: req.method, headers, body: req.body }));
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
