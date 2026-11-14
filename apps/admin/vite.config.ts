import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png', 'emblem.webp', 'wordmark.webp'],
      manifest: {
        name: 'Femia Admin Studio', short_name: 'Femia Admin', description: 'Run the Femia store from your phone.',
        theme_color: '#7A1628', background_color: '#FBF1E9', display: 'standalone', start_url: '/', scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Add product', url: '/products/new' },
          { name: 'New order', url: '/orders/new' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/media\//, /^\/cdn-cgi\//],
        globPatterns: ['**/*.{js,css,html,png,webp,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 4_000_000,
      },
    }),
  ],
  server: {
    proxy: {
      // Dev: Admin → Core API. Production: worker/index.ts proxies via service binding.
      '/api': { target: 'http://localhost:8787', rewrite: (p) => p.replace(/^\/api/, '') },
      '/media': { target: 'http://localhost:8787' },
    },
  },
  build: { target: 'es2022', sourcemap: true },
  worker: { format: 'es' },
});
