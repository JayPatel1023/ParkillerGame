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
// failed load retries automatically (with backoff) up to MAX_ATTEMPTS times, and returns a plain
// texture-or-null value rather than suspending - callers render a real (if plain) fallback while
// waiting/retrying, so a slow or even a fully failed load still shows *something* recognizable as
// "the board, still settling in" instead of empty space with pieces floating over nothing.
const MAX_ATTEMPTS = 5
const RETRY_BASE_DELAY_MS = 800

const textureCache = new Map<string, THREE.Texture>()
const loader = new THREE.TextureLoader()

function loadWithRetry(url: string, attempt: number, onSuccess: (texture: THREE.Texture) => void) {
  loader.load(
    url,
    (texture) => {
      textureCache.set(url, texture)
      onSuccess(texture)
    },
    undefined,
    () => {
      if (attempt >= MAX_ATTEMPTS) return // gives up silently - caller's own fallback stays showing
      setTimeout(() => loadWithRetry(url, attempt + 1, onSuccess), RETRY_BASE_DELAY_MS * attempt)
    },
  )
}

export function useRobustTexture(url: string): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(() => textureCache.get(url) ?? null)

  useEffect(() => {
    const cached = textureCache.get(url)
    if (cached) {
      setTexture(cached)
      return
    }
    let cancelled = false
    setTexture(null)
    loadWithRetry(url, 1, (loaded) => {
      if (!cancelled) setTexture(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [url])

  return texture
}
