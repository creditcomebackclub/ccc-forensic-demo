import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  WEBSITE_LIVE_FILES,
  WEBSITE_SHARED_FILES,
  createWebsiteReleaseCss,
  createWebsiteReleaseHtml,
} from './website-preview/release-build.mjs';

function websiteReleaseArtifacts() {
  return {
    name: 'ccc-website-release-artifacts',
    apply: 'build',
    async closeBundle() {
      const source = resolve(process.cwd(), 'website-preview');
      const htmlSource = await readFile(resolve(source, 'index.html'), 'utf8');
      const cssSource = await readFile(resolve(source, 'styles.css'), 'utf8');

      for (const release of [
        { mode: 'preview', directory: 'site-preview', files: WEBSITE_SHARED_FILES },
        { mode: 'live', directory: 'site-live', files: [...WEBSITE_SHARED_FILES, ...WEBSITE_LIVE_FILES] },
      ]) {
        const destination = resolve(process.cwd(), `dist/${release.directory}`);
        await mkdir(destination, { recursive: true });
        await writeFile(
          resolve(destination, 'index.html'),
          createWebsiteReleaseHtml(htmlSource, release.mode),
          'utf8',
        );
        await writeFile(
          resolve(destination, 'styles.css'),
          createWebsiteReleaseCss(cssSource, release.mode),
          'utf8',
        );
        await Promise.all(release.files.map((file) => (
          copyFile(resolve(source, file), resolve(destination, file))
        )));
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    websiteReleaseArtifacts(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'logo.jpg',
        'brand-assets/ccc-app-icon-192.png',
        'brand-assets/ccc-app-icon-512.png',
      ],
      manifestFilename: 'manifest.json',
      workbox: {
        // These are static marketing/legal pages served alongside the SPA,
        // not app routes — they must always be fetched fresh. Without this,
        // the SW's default SPA navigation fallback (any navigation not
        // explicitly excluded gets served the cached index.html) hijacks
        // them for any browser that already has the SW installed, showing
        // the app shell instead of the real page.
        //
        // The same hijack applies to any server endpoint opened as a
        // navigation rather than fetched — /.netlify/functions/* directly and
        // /api/* via the netlify.toml redirect. window.open()ing one of those
        // (portal-agreement-view, guide-download) would otherwise load the
        // cached app shell into the new tab, which boots the SPA at its
        // default tab instead of showing the document.
        navigateFallbackDenylist: [/^\/$/, /^\/freeguide/, /^\/home/, /^\/join/, /^\/terms/, /^\/privacy/, /^\/croa-statement/, /^\/cancellation-refund-policy/, /^\/success/, /^\/sign-lpoa/, /^\/+affiliate(?:\/apply|-apply\.html)/, /^\/downloads\//, /^\/site-preview\//, /^\/site-live\//, /^\/new-site-preview\/?$/, /^\/\.netlify\//, /^\/api\//],
        globIgnores: ['**/freeguide.html', '**/home.html', '**/join.html', '**/affiliate-apply.html', '**/terms.html', '**/privacy.html', '**/croa-statement.html', '**/cancellation-refund-policy.html', '**/success.html', '**/sign-lpoa.html', 'downloads/**', 'site-preview/**', 'site-live/**'],
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
            src: 'brand-assets/ccc-app-icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'brand-assets/ccc-app-icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'brand-assets/ccc-app-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
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
