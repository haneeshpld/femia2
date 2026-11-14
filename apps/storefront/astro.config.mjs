// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? 'http://localhost:4321',
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough', persistState: { path: '../../.wrangler/state' } }),
  session: false,
  integrations: [react()],
  // Every internal link is fetched on hover / first touch, so client-router navigations feel instant.
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  build: { inlineStylesheets: 'auto' },
  vite: { server: { fs: { allow: ['../..'] } } },
});
