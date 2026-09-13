import { useEffect, useState } from 'react'
import * as THREE from 'three'

// Client reported directly, with screenshots: pieces and dice rendering fine, floating over
// completely empty space - no board, no track squares at all. "A menudo el tablero no carga a la
// primera" / "화면이 천천히 나올때도있고 그림이 안나올때도있고" (sometimes it's slow, sometimes the
// image just never shows). Root cause: BoardMesh and TrackTile both used to load their textures via
// drei/fiber's Suspense-based useTexture/useLoader, each wrapped in <Suspense fallback={null}> - if
// the underlying fetch ever fails (a network hiccup, a flaky connection, anything), that resource's
// promise rejects and stays rejected forever in the shared loader cache those hooks share, with no
// automatic retry. The Suspense boundary is then stuck showing its own fallback (null, here) for
// the rest of that session, with zero visual indication anything went wrong - not "loading", just
// silently, permanently absent. Everything else in the scene (pieces, dice - no async texture of
// their own) kept rendering fine on top of that missing board, exactly the reported symptom.
//
// This hook manages its own retry loop instead of throwing a promise for Suspense to catch: a
// failed load retries automatically (with backoff, see MAX_RETRY_DELAY_MS below), and returns a
// plain texture-or-null value rather than suspending - callers render a real (if plain) fallback
// while waiting/retrying, so a slow or even a currently-failing load still shows *something*
// recognizable as "the board, still settling in" instead of empty space with pieces floating over
// nothing.
const RETRY_BASE_DELAY_MS = 800
// Reported directly, again, still permanently blank on the very first screen a session ever shows
// ("아직 같은현상이다" - it's still the same thing) - a board image is essential, always-valid,
// permanently-hosted content, never a real 404 the way an arbitrary user-supplied URL might be, so
// there's no scenario where giving up on it forever is the right call. The one real failure mode
// this actually protects against - a brief, ordinary squeeze on the network right at page load,
// while the JS bundle, PWA precache, board texture, and every other board's own preloadTexture call
// (App.tsx) are all competing for the same limited number of concurrent connections - is exactly
// the kind of thing that clears up on its own within seconds, well within a real player's own
// session; the old fixed 5-attempt backoff (summing to ~8s total) can plausibly run out before that
// squeeze does, especially on a slow connection, and once it gave up nothing here would ever try
// again for the rest of that mount's lifetime unless the component happens to remount for an
// unrelated reason (a navigation, or webglContextRecovery's own forced remount on a stuck context -
// neither of which this specific report's own screen, sitting still on the online menu, would ever
// trigger). Retries now continue indefinitely instead of stopping - MAX_RETRY_DELAY_MS caps how
// slow that gets, so a genuinely dead network still only costs one attempt every 15s, not a
// runaway loop, while a temporary one clears itself up automatically the next time this fires.
const MAX_RETRY_DELAY_MS = 15_000

const textureCache = new Map<string, THREE.Texture>()
const loader = new THREE.TextureLoader()

// Reported again after the fix above shipped, still persistently blank ("그림이 비루스먹은것처럼
// 없어지고 흰판이다" - the image vanishes like it's got a virus, it's a white board) - this time on
// the actual in-game board too, not just the decorative start-screen one. Root cause: this hook had
// no cross-instance request sharing, unlike the useLoader/useTexture it replaced (both share a
// single in-flight promise per url via R3F's own Suspense cache). TrackTile mounts once per track
// square - 51 to 72 of them depending on player count (see generated-boards.json) - and every one
// calls this hook for the SAME 2 shared tile images (tile-fill.png/tile-border.png). With no
// dedup, that's 100+ simultaneous independent fetch-and-retry chains for 2 files on every board
// load, easily enough to saturate a slow/mobile connection or a browser's per-origin connection
// limit and cause the very "images don't load" symptom this hook was meant to fix - likely worse
// than the original bug for exactly this reason. `inFlight` tracks one real load per url, with every
// concurrent caller just subscribing to its result instead of starting its own.
const inFlight = new Map<string, Set<(texture: THREE.Texture) => void>>()

function loadWithRetry(url: string, attempt: number) {
  // A failed fetch can still be an HTTP 200 (e.g. an SPA history-fallback serving index.html for a
  // path that doesn't exist, which several static hosts - including this app's own preview/deploy
  // setup - do instead of a real 404) with `Cache-Control: no-cache`, which permits the browser to
  // store the response and merely revalidate it later, not skip caching outright. Confirmed
  // directly: the underlying file becoming available again mid-retry (verified with curl - the
  // server serves it correctly immediately) did NOT fix a stuck retry loop in the browser, only a
  // hard reload did - a cache-busting query param on every retry after the first guarantees each
  // one is a genuinely fresh request, sidestepping the browser's own cache/revalidation behavior
  // for `Image()`-triggered loads entirely rather than depending on it working correctly.
  const requestUrl = attempt === 1 ? url : `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`
  loader.load(
    requestUrl,
    (texture) => {
      textureCache.set(url, texture)
      const subscribers = inFlight.get(url)
      inFlight.delete(url)
      subscribers?.forEach((notify) => notify(texture))
    },
    undefined,
    () => {
      // See MAX_RETRY_DELAY_MS's own doc comment above - never actually gives up; the fallback
      // stays showing only until whichever attempt finally lands.
      const delay = Math.min(RETRY_BASE_DELAY_MS * attempt, MAX_RETRY_DELAY_MS)
      setTimeout(() => loadWithRetry(url, attempt + 1), delay)
    },
  )
}

// Reported directly, with a video: even a healthy fetch still takes some non-zero real time, so
// the very first time a board's texture is actually needed - right as the game screen itself
// mounts - there's an inherent gap before it's cached, during which BoardMesh/TrackTile render
// their plain fallback color ("로딩속도가뜬것으로 하여 오락판이 현시될때 먼저 흰판이 되였다가 오락판이
// 생긴다" - because of the loading speed, the board first becomes a white board before the real
// board appears). Confirmed directly against the live deployed site: this flash is real, brief
// (~150ms), and happens every time a board is shown for the first time in a session. The fix isn't
// another retry/fallback improvement (the fetch already succeeds fine) - it's not needing to fetch
// at that moment at all. Call this once, as early as possible (App.tsx, on mount), for every image
// this session could plausibly need - by the time a player has clicked through player-count and
// color selection (multiple real seconds of human interaction), the fetch has almost always long
// since finished and populated the same `textureCache` useRobustTexture itself reads from, so the
// eventual real mount hits the cache-first path and renders immediately, no flash at all.
export function preloadTexture(url: string): void {
  if (textureCache.has(url) || inFlight.has(url)) return
  inFlight.set(url, new Set())
  loadWithRetry(url, 1)
}

export function useRobustTexture(url: string): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(() => textureCache.get(url) ?? null)

  useEffect(() => {
    const cached = textureCache.get(url)
    if (cached) {
      setTexture(cached)
      return
    }
    setTexture(null)
    let subscribers = inFlight.get(url)
    const isFirstSubscriber = !subscribers
    if (!subscribers) {
      subscribers = new Set()
      inFlight.set(url, subscribers)
    }
    subscribers.add(setTexture)
    if (isFirstSubscriber) loadWithRetry(url, 1)
    return () => {
      inFlight.get(url)?.delete(setTexture)
    }
  }, [url])

  return texture
}
