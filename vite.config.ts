import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Reported directly (a client screenshot of a stale build, still on the old blue button
      // style days after it shipped - production itself was confirmed fully up to date at the
      // exact same moment): registerType 'autoUpdate' only makes an *already-detected* update
      // apply itself without asking - it doesn't make the browser go looking for one. The default
      // auto-injected registration only checks on this navigation, so a tab left open across many
      // real testing sessions (exactly how this app tends to get used) can sit on a stale cached
      // build indefinitely, however many times it's redeployed underneath it. `injectRegister:
      // false` here hands registration to App.tsx's own useRegisterSW call instead, specifically
      // so it can also poll `registration.update()` on an interval - see that file's own comment.
      injectRegister: false,
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
        // Reported directly, repeatedly, recurring across multiple normal reloads ("그냥 F5을 누르면
        // 이화면이다" - a plain F5 still shows the old screen; only a hard reload, Ctrl+Shift+R,
        // shows the current one): registerType 'autoUpdate' only auto-injects skipWaiting/
        // clientsClaim into the *plugin's own* registration script - see this project's own
        // node_modules/vite-plugin-pwa/dist/index.js, `if ((injectRegister === 'auto' ||
        // injectRegister == null) && registerType === 'autoUpdate') { workbox.skipWaiting = true;
        // workbox.clientsClaim = true }`. injectRegister was set to false above (App.tsx's own
        // useRegisterSW call registers instead, specifically to add the periodic registration.update()
        // poll below) - which silently skipped this same injection, since the condition it's guarded
        // on no longer holds. Confirmed directly in the built dist/sw.js: self.skipWaiting() was only
        // ever wired to fire on an explicit SKIP_WAITING postMessage, which nothing in "auto" mode's
        // client code actually sends (it only listens for the SW to reach "activated" on its own) -
        // so a newly-installed SW just sat in "waiting" forever, never taking over, for as long as
        // the tab stayed open across any number of reloads. A hard reload "worked" only because
        // bypassing the browser cache also bypasses the service worker's own fetch interception for
        // that one load, serving the real current build straight from the network - not because the
        // SW itself had actually updated. Setting these directly here (not relying on the plugin's
        // own conditional injection) restores the self-activating behavior 'autoUpdate' is supposed
        // to mean, while keeping App.tsx's own custom registration/update-poll intact.
        skipWaiting: true,
        clientsClaim: true,
        // Board art, tiles, and backgrounds are small (a few MB total) - precache everything so
        // the game (boards included) works fully offline right after the first load, not just
        // the app shell. mp3 added alongside hopSound.ts's own hop.mp3 - same reasoning, a few KB
        // is nothing against the budget below, and a move's own sound shouldn't depend on network
        // timing any more than the board art it plays alongside does.
        globPatterns: ['**/*.{js,css,html,jpg,png,svg,ico,mp3}'],
        // public/music/ holds the intro/background music track (introMusic.ts) - several MB,
        // unlike every other mp3 here (a few KB to ~70KB apiece). Unlike hop/capture/finish
        // sounds, nothing about actually playing the game depends on it - same "don't force every
        // visitor to download something big upfront" reasoning this file's own rules.pdf exclusion
        // below already uses, not a blanket precache-everything case. Loaded on demand instead
        // (still cacheable by the browser's normal HTTP cache once played), same as the PDF.
        globIgnores: ['music/**'],
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
