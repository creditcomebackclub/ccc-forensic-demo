import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.jpg'],
      manifestFilename: 'manifest.json',
      workbox: {
        // These are static marketing/legal pages served alongside the SPA,
        // not app routes — they must always be fetched fresh. Without this,
        // the SW's default SPA navigation fallback (any navigation not
        // explicitly excluded gets served the cached index.html) hijacks
        // them for any browser that already has the SW installed, showing
        // the app shell instead of the real page.
        navigateFallbackDenylist: [/^\/freeguide/, /^\/home/, /^\/terms/, /^\/privacy/, /^\/success/, /^\/sign-lpoa/, /^\/downloads\//],
        globIgnores: ['**/freeguide.html', '**/home.html', '**/terms.html', '**/privacy.html', '**/success.html', '**/sign-lpoa.html', 'downloads/**'],
      },
      manifest: {
        name: 'Credit Comeback Club',
        short_name: 'CCC Works',
        description: 'Credit Comeback Club Forensic Credit Dispute Suite',
        theme_color: '#1B2A4A',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'logo.jpg',
            sizes: '192x192',
            type: 'image/jpeg'
          },
          {
            src: 'logo.jpg',
            sizes: '512x512',
            type: 'image/jpeg'
          },
          {
            src: 'logo.jpg',
            sizes: '512x512',
            type: 'image/jpeg',
            purpose: 'maskable'
          }
        ]
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      // For local dev: proxy /api requests to netlify dev server (port 8888)
      '/api': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  },
});
