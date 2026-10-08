import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH is set by the GitHub Pages workflow (e.g. /sensinth/).
// NATIVE=1 builds for the Android app, which needs no service worker.
const native = process.env.NATIVE === '1';
const base = native ? '/' : (process.env.BASE_PATH ?? '/');

export default defineConfig({
  base,
  server: { host: true },
  build: { target: 'es2022' },
  plugins: [
    VitePWA({
      disable: native,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Sensinth',
        short_name: 'Sensinth',
        description: 'Generative music from your phone sensors.',
        theme_color: '#0b0805',
        background_color: '#0b0805',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
});
