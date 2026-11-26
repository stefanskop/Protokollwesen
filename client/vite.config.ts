import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Kostenverfolgung Hochbau: Die eigenständige HTML-Datei (kosten/Kostenverfolgung.html) wird unverändert
 * übernommen und um das Abgleich-Skript ergänzt. Ergebnis: /kosten/index.html und /kosten/kosten-sync.js
 * Für eine neue Version der Kostenverfolgung genügt es, kosten/Kostenverfolgung.html zu ersetzen.
 */
function kostenverfolgung(): Plugin {
  const dir = path.resolve(__dirname, '../kosten');
  const html = () => {
    const src = fs.readFileSync(path.join(dir, 'Kostenverfolgung.html'), 'utf8');
    const tag = '<script src="/kosten/kosten-sync.js"></script>\n';
    const i = src.lastIndexOf('</body>');
    if (i < 0) throw new Error('Kostenverfolgung.html: </body> nicht gefunden');
    return src.slice(0, i) + tag + src.slice(i);
  };
  const js = () => fs.readFileSync(path.join(dir, 'kosten-sync.js'), 'utf8');
  return {
    name: 'kostenverfolgung',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'kosten/index.html', source: html() });
      this.emitFile({ type: 'asset', fileName: 'kosten/kosten-sync.js', source: js() });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (url === '/kosten' || url === '/kosten/' || url === '/kosten/index.html') {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.end(html());
        }
        if (url === '/kosten/kosten-sync.js') {
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          return res.end(js());
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    kostenverfolgung(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        navigateFallback: '/index.html',
        // Die Kostenverfolgung (/kosten/) ist eine eigene Seite und darf nicht durch die App ersetzt werden
        navigateFallbackDenylist: [/^\/api\//, /^\/kosten/],
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.mode === 'navigate' && url.pathname.startsWith('/kosten'),
            handler: 'NetworkFirst',
            options: { cacheName: 'kosten-seite', networkTimeoutSeconds: 4 },
          },
        ],
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      manifest: {
        name: 'Protokollwesen – Skop Bauconsulting',
        short_name: 'Protokolle',
        lang: 'de',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#002E5E',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:8080' } },
  build: { chunkSizeWarningLimit: 3000 },
});
