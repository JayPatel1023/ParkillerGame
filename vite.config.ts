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
        // timing any more than the board art it plays alongside does. webp added alongside the
        // board textures' own jpg -> webp conversion (see boards/board_*.jpg's own globIgnores
        // entry below) - without this, the smaller files this precache exists to serve wouldn't
        // even match the pattern.
        globPatterns: ['**/*.{js,css,html,jpg,png,webp,svg,ico,mp3}'],
        // public/music/ holds the intro/background music track (introMusic.ts) - several MB,
        // unlike every other mp3 here (a few KB to ~70KB apiece). Unlike hop/capture/finish
        // sounds, nothing about actually playing the game depends on it - same "don't force every
        // visitor to download something big upfront" reasoning this file's own rules.pdf exclusion
        // below already uses, not a blanket precache-everything case. Loaded on demand instead
        // (still cacheable by the browser's normal HTTP cache once played), same as the PDF.
        //
        // public/reference/ holds the client's own physical-figurine reference PHOTOS
        // (parkiller-full/angle/front/side/back.png, ~4.2MB total) - inputs for the #parkiller-
        // editor dev tool (ParkillerEditor.tsx) used to hand-tune ParkillerMesh.tsx's own
        // DEFAULT_PARKILLER_CONFIG, never loaded by the actual shipped game. "Precache everything"
        // above was blindly pulling all 4.2MB of them into every regular player's first-load
        // download (reported directly as slow loading, and confirmed by the built dist/sw.js
        // precache manifest - ~14.8MB total, of which this one directory alone was well over a
        // quarter) for art no player's own device ever renders.
        //
        // boards/board_*.jpg: reported directly, with a screenshot, that the board still failed to
        // render (a flat gray plane) on a poor connection even after the earlier reconnect fix -
        // these 5 files are still real inputs scripts/generate-waypoints.mjs reads directly (its
        // own hardcoded `public/boards/board_${playerCount}p.jpg` path), so they stay in the repo,
        // but generated-boards.json's own boardImage field now points at a same-art .webp sibling
        // instead (~45% smaller, converted directly - see that JSON's own git history) for what the
        // live app actually fetches. Left unexcluded, these superseded originals would still match
        // globPatterns' own jpg extension and get precached anyway, on top of the smaller webp
        // files nothing in the running app ever asks for - pure wasted download for every player.
        globIgnores: ['music/**', 'reference/**', 'boards/board_*.jpg'],
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
