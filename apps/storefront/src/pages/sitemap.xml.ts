import type { APIRoute } from 'astro';
import { api } from '../lib/api.ts';

export const GET: APIRoute = async ({ site }) => {
  const [cats, colls, first] = await Promise.all([api().catalog.categories(), api().catalog.collections(), api().catalog.products({ pageSize: 48, page: 1 })]);
  const pages = Math.ceil(first.total / 48);
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => api().catalog.products({ pageSize: 48, page: i + 2 })));
  const products = [first, ...rest].flatMap((p) => p.items);
  const urls = [
    '/', '/shop', '/collections', '/visit', '/about', '/size-guide', '/track',
    ...['shipping', 'returns', 'privacy', 'terms', 'contact'].map((s) => `/policies/${s}`),
    ...cats.map((c) => `/shop/${c.slug}`), ...colls.map((c) => `/collections/${c.slug}`), ...products.map((p) => `/products/${p.slug}`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${new URL(u, site)}</loc></url>`).join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' } });
};
