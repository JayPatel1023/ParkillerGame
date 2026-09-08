import { useEffect, useState } from 'react'
import type { BufferGeometry } from 'three'
import { STLLoader } from 'three-stdlib'

// Same retry/dedup/cache recipe as useRobustTexture.ts (see that file's own doc comment for the
// original bug this pattern fixes) - a plain Suspense-based loader here would suspend the whole
// piece on a flaky fetch with no retry and no visible fallback, the exact failure mode that hook
// was built to avoid for board textures. Reused as-is for the Parkiller's own STL scan rather than
// re-deriving a second ad hoc loading strategy.
const MAX_ATTEMPTS = 5
const RETRY_BASE_DELAY_MS = 800

const geometryCache = new Map<string, BufferGeometry>()
const loader = new STLLoader()
const inFlight = new Map<string, Set<(geometry: BufferGeometry) => void>>()

function loadWithRetry(url: string, attempt: number) {
  const requestUrl = attempt === 1 ? url : `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`
  loader.load(
    requestUrl,
    (geometry) => {
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
    },
    undefined,
    () => {
      if (attempt >= MAX_ATTEMPTS) {
        inFlight.delete(url)
        return
      }
      setTimeout(() => loadWithRetry(url, attempt + 1), RETRY_BASE_DELAY_MS * attempt)
    },
  )
}

export function preloadSTL(url: string): void {
  if (geometryCache.has(url) || inFlight.has(url)) return
  inFlight.set(url, new Set())
  loadWithRetry(url, 1)
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
    return () => {
      inFlight.get(url)?.delete(setGeometry)
    }
  }, [url])

  return geometry
}
