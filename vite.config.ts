import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Parkiller',
        short_name: 'Parkiller',
        description: 'Parkiller - parchís para 2 a 6 jugadores',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#1a1310',
        theme_color: '#ccb154',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Board art, tiles, and backgrounds are small (a few MB total) - precache everything so
        // the game (boards included) works fully offline right after the first load, not just
        // the app shell.
        globPatterns: ['**/*.{js,css,html,jpg,png,svg,ico}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Reported directly ("직접 문서로 가게 만들라" - make it go directly to the document):
        // clicking the help card's own rulebook PDF link opened the app's start screen instead of
        // the PDF. Root cause - the service worker's default navigateFallback serves index.html
        // for *any* full-page navigation request that doesn't match a precached asset, and
        // rules.pdf is deliberately excluded from precache above (globPatterns has no .pdf, per
        // that same comment - it's a 30MB reference document, not something every visitor should
        // download upfront) - target="_blank" on an <a> is exactly this kind of "navigate" request,
        // so it hit that fallback instead of reaching the real file. Excluding it here lets the
        // browser fetch it from the network/its own HTTP cache like any other uncached static
        // asset, same as it already would if this PWA had no service worker at all.
        navigateFallbackDenylist: [/\.pdf$/],
      },
    }),
  ],
})
