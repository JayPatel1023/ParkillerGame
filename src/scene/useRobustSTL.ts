import { useEffect, useState } from 'react'
import type { BufferGeometry } from 'three'
import { STLLoader } from 'three-stdlib'

// Same retry/dedup/cache recipe as useRobustTexture.ts (see that file's own doc comment for the
// original bug this pattern fixes) - a plain Suspense-based loader here would suspend the whole
// piece on a flaky fetch with no retry and no visible fallback, the exact failure mode that hook
// was built to avoid for board textures. Reused as-is for the Parkiller's own STL scan rather than
// re-deriving a second ad hoc loading strategy.
//
// Reported directly, with a screenshot: pieces and dice rendering fine, the board and the
// Parkiller both missing from the same scene. The board recovered on its own moments later
// (useRobustTexture.ts's own indefinite retry, working as designed); the Parkiller never did -
// this file was never updated when that sibling hook's own MAX_ATTEMPTS (a hard cap that gives up
// permanently, exactly the bug useRobustTexture.ts was built to fix) was replaced with an
// indefinite retry capped only by delay, not attempt count. A Parkiller scan is exactly as
// essential, always-valid, permanently-hosted content as a board texture - there's no more a real
// 404 here than there - so the same fix applies for the same reason: MAX_RETRY_DELAY_MS caps how
// *slow* retrying gets on a genuinely dead connection, not how many times it's allowed to try.
const RETRY_BASE_DELAY_MS = 800
const MAX_RETRY_DELAY_MS = 15_000

// Reported again ("A veces al cargar sigue apareciendo la pantalla sin tablero" - sometimes on
// load the screen without a board still shows up), after useRobustTexture.ts's own watchdog fix
// for exactly this had already shipped - this file was never given the same fix. A request that
// hangs (never fires either load or error) defeats every retry-on-error mechanism above with
// nothing to react to, same root cause and same fix as that sibling hook's own LOAD_TIMEOUT_MS -
// see its doc comment for the full reasoning (a stalled connection, not a clean failure, evidenced
// there directly via a stuck "(pending)" DevTools request).
const LOAD_TIMEOUT_MS = 10_000

// Exported (alongside `inFlight` below and `loadWithRetry` further down) purely so the retry/abort
// mechanism is directly testable without a React-rendering harness (this project has none - see
// tests/toastFadeOutHold.test.ts for the same pattern) - production callers only ever use
// `preloadSTL`/`useRobustSTL`.
export const geometryCache = new Map<string, BufferGeometry>()
const loader = new STLLoader()
export const inFlight = new Map<string, Set<(geometry: BufferGeometry) => void>>()

// Reported directly, with three DevTools Network-tab screenshots taken a few seconds apart during
// a real game ("좀빨리 버튼들을 누르면 이렇게 된다" - if you press the buttons a bit fast, this
// happens): `parkiller.stl?retry=2` AND `parkiller.stl?retry=3` both showed up as separate,
// eventually-completed (200) log entries for what should be one logical load, one of them taking
// 12.67s for a file that (per its own sibling entry) loads in a little over a second once it gets
// a clear run. Same root cause and same fix as useRobustTexture.ts's own matching round of this -
// see that file's doc comment for the full writeup (confirmed live via Playwright: the watchdog
// firing a retry never cancelled the attempt it was superseding, so the old attempt's real request
// just kept running and completing on its own, as a second concurrent connection rather than being
// replaced; the `settled` guard already correctly no-ops its late result, so this was a wasted-
// connection bug, not a state-corruption one). `STLLoader.load()`'s own delegate, three's
// `FileLoader`, has no cancellation hook either (its own source carries a literal "An abort
// controller could be added within a future PR" comment) - fixed the same way, by fetching the
// bytes ourselves behind an `AbortController` and handing them to `loader.parse()`, which
// `STLLoader.load()` already calls internally on whatever `FileLoader` hands it, so this is a
// faithful substitution, not a new code path.
export function loadWithRetry(url: string, attempt: number) {
  const requestUrl = attempt === 1 ? url : `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`
  // See LOAD_TIMEOUT_MS's own doc comment above, and useRobustTexture.ts's matching `settled`
  // guard - stops both the watchdog and a late-arriving real load/error from double-handling the
  // same attempt.
  let settled = false
  // One AbortController per attempt, so retiring an attempt can actually cancel its underlying
  // fetch instead of only gating what happens with its result.
  const controller = new AbortController()
  const retryAfterFailure = () => {
    if (settled) return
    settled = true
    controller.abort()
    const delay = Math.min(RETRY_BASE_DELAY_MS * attempt, MAX_RETRY_DELAY_MS)
    setTimeout(() => loadWithRetry(url, attempt + 1), delay)
  }
  const watchdog = setTimeout(retryAfterFailure, LOAD_TIMEOUT_MS)
  fetch(requestUrl, { signal: controller.signal })
    .then((response) => {
      if (!response.ok) throw new Error(`useRobustSTL: HTTP ${response.status} for ${requestUrl}`)
      return response.arrayBuffer()
    })
    .then((buffer) => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      const geometry = loader.parse(buffer)
      // The client's own STL scan (etc/'s "FIGURA DEL PARKILLER") was exported Z-up (tallest
      // dimension, hood-tip to base, is its Z axis - 33mm vs 18x18) rather than three.js's own
      // Y-up convention - rendered as-is, the whole figure lay on its side. Baked in once here
      // (not per-consumer) since every caller of this specific loader wants the same correction.
      geometry.rotateX(-Math.PI / 2)
      geometry.computeVertexNormals()
      // Re-centered on X/Z and dropped so its own base sits at y=0 - the scan's raw coordinates
      // are wherever the scanner's own origin happened to be (offset ~20-40mm from true zero on
      // every axis), not usable directly against ParkillerMesh's own restPosition/BASE_HEIGHT
      // convention (piece origin at its own base, centered on X/Z) without this.
      geometry.computeBoundingBox()
      const bb = geometry.boundingBox!
      const centerX = (bb.min.x + bb.max.x) / 2
      const centerZ = (bb.min.z + bb.max.z) / 2
      geometry.translate(-centerX, -bb.min.y, -centerZ)
      geometry.computeBoundingBox()
      geometryCache.set(url, geometry)
      const subscribers = inFlight.get(url)
      inFlight.delete(url)
      subscribers?.forEach((notify) => notify(geometry))
    })
    .catch(() => {
      // Also reached when `controller.abort()` above rejects this attempt's own fetch - `settled`
      // is already true by then (retryAfterFailure sets it before aborting), so this is a no-op:
      // the attempt that superseded this one is already the one driving things forward.
      if (settled) return
      clearTimeout(watchdog)
      retryAfterFailure()
    })
}

export function preloadSTL(url: string): void {
  if (geometryCache.has(url) || inFlight.has(url)) return
  inFlight.set(url, new Set())
  loadWithRetry(url, 1)
}

// Reported directly, still missing ("아직보드가 없어지는문제가 발생하고있다" - the board-disappearing
// problem is still happening), reproducing when clicking through the setup screens very fast right
// after the app loads - the same report's own screenshot showed parkiller.stl sitting as
// `(canceled)` with nothing after it, same shape as useRobustTexture.ts's own matching bug (see
// that file's STUCK_RETRY_MS doc comment for the full root-cause writeup: the gap between one
// attempt aborting and the next one actually starting is a bare, uncancellable `setTimeout` with
// nothing watching it, and if that timer ever fails to fire, the chain quietly stops forever with
// `inFlight` still claiming a load is in progress). Same fix, same reasoning: each mounted consumer
// arms its own independent safety net that starts a fresh attempt if this url still has neither a
// cached geometry nor a resolved load within STUCK_RETRY_MS of THIS mount.
const STUCK_RETRY_MS = 20_000

// Pulled out of the hook's effect (which a rendering harness this project doesn't have would
// otherwise be needed to exercise) purely so this specific timer is directly testable - same
// reasoning as useRobustTexture.ts's own armStuckRetryWatchdog.
export function armStuckRetryWatchdog(url: string): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    if (!geometryCache.has(url)) loadWithRetry(url, 1)
  }, STUCK_RETRY_MS)
}

export function useRobustSTL(url: string): BufferGeometry | null {
  const [geometry, setGeometry] = useState<BufferGeometry | null>(() => geometryCache.get(url) ?? null)

  useEffect(() => {
    const cached = geometryCache.get(url)
    if (cached) {
      setGeometry(cached)
      return
    }
    setGeometry(null)
    let subscribers = inFlight.get(url)
    const isFirstSubscriber = !subscribers
    if (!subscribers) {
      subscribers = new Set()
      inFlight.set(url, subscribers)
    }
    subscribers.add(setGeometry)
    if (isFirstSubscriber) loadWithRetry(url, 1)
    const stuckTimer = armStuckRetryWatchdog(url)
    return () => {
      clearTimeout(stuckTimer)
      inFlight.get(url)?.delete(setGeometry)
    }
  }, [url])

  return geometry
}
