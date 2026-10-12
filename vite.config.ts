/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Sub-path hosting (GitHub Pages serves the app at /Woombad/): set VITE_BASE_PATH=/Woombad/ at build time.
// Root hosting (Cloudflare Pages, Netlify, Vercel, own domain) leaves it unset.
const base = (process.env.VITE_BASE_PATH ?? '/').replace(/\/?$/, '/')

// Pages of builds with registerType 'autoUpdate' reload only when a new service worker activates by itself. Until a
// 'prompt' worker has been active once on this device, a new worker therefore takes over at once (so those pages still
// update themselves); after that it waits until main.tsx applies it.
const SW_HANDOVER = `const MARKER = 'woombad-sw-prompt'
self.addEventListener('install', (event) => {
  event.waitUntil(caches.has(MARKER).then((prompt) => (prompt ? undefined : self.skipWaiting())))
})
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.open(MARKER))
})
`

function swHandover(): Plugin {
  return {
    name: 'woombad-sw-handover',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sw-handover.js', source: SW_HANDOVER })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    swHandover(),
    VitePWA({
      // 'prompt': main.tsx applies a new version itself, and waits for a tap while a reload would lose work
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Woombad - Manajemen Kos',
        short_name: 'Woombad',
        description: 'Aplikasi manajemen kos: penyewa, tagihan, pembayaran, pengeluaran, dan laporan keuangan.',
        lang: 'id',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // tesseract.js language data and workers are large; cache them at runtime instead of precaching.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/node_modules/**/*', 'sw-handover.js'],
        importScripts: ['sw-handover.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'cdn-cache', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: /^https:\/\/tessdata\.projectnaptha\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'tessdata-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 90 } },
          },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
