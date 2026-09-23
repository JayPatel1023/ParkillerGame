import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Same fix, same bug, as tests/robustAssetLoaderAbort.test.ts's own doc comment describes for
// useRobustTexture.ts - see that file for the full writeup. This file exercises the identical
// abort-on-retry mechanism in useRobustSTL.ts's `loadWithRetry`, which had the exact same gap
// (STLLoader.load()'s own delegate, three's FileLoader, has no cancellation hook either).

const LOAD_TIMEOUT_MS = 10_000
const RETRY_BASE_DELAY_MS = 800

// A minimal, valid, zero-triangle binary STL: an 80-byte header followed by a little-endian
// uint32 triangle count of 0. STLLoader.parse()'s own isBinary() check accepts this because the
// buffer's length (84) matches exactly what a 0-triangle binary file's header+count predicts.
function emptyBinarySTLBuffer(): ArrayBuffer {
  return new ArrayBuffer(84)
}

type FetchCall = { url: string; signal: AbortSignal }

function installFetchMock() {
  const calls: FetchCall[] = []
  const pending: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = []
  const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
    calls.push({ url, signal: opts!.signal as AbortSignal })
    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject })
      ;(opts!.signal as AbortSignal).addEventListener('abort', () => {
        const err = new Error('aborted')
        err.name = 'AbortError'
        reject(err)
      })
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, pending, fetchMock }
}

// See robustAssetLoaderAbort.test.ts's own `flush` helper for why this loops rather than awaiting
// a fixed number of `Promise.resolve()`s.
async function flush(times = 8) {
  for (let i = 0; i < times; i++) {
    await vi.advanceTimersByTimeAsync(0)
  }
}

describe('useRobustSTL - watchdog-triggered retries abort the attempt they supersede', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("aborts attempt 1's fetch before starting attempt 2 once the watchdog fires", async () => {
    const { calls } = installFetchMock()
    const { loadWithRetry } = await import('../src/scene/useRobustSTL')

    loadWithRetry('/parkiller.stl', 1)
    expect(calls).toHaveLength(1)
    expect(calls[0].signal.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + RETRY_BASE_DELAY_MS)
    await flush()

    expect(calls[0].signal.aborted).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[1].url).toBe('/parkiller.stl?retry=2')
    expect(calls[1].signal.aborted).toBe(false)
  })

  it("caches attempt 2's parsed geometry once it lands, and the abandoned/aborted attempt 1 cannot clobber it later", async () => {
    const { calls, pending } = installFetchMock()
    const { loadWithRetry, geometryCache, inFlight } = await import('../src/scene/useRobustSTL')

    inFlight.set('/parkiller.stl', new Set())
    loadWithRetry('/parkiller.stl', 1)
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + RETRY_BASE_DELAY_MS)
    await flush()
    expect(calls).toHaveLength(2)

    pending[1].resolve({ ok: true, arrayBuffer: () => Promise.resolve(emptyBinarySTLBuffer()) })
    await flush()

    const geometryAfterAttempt2 = geometryCache.get('/parkiller.stl')
    expect(geometryAfterAttempt2).toBeDefined()
    expect(inFlight.has('/parkiller.stl')).toBe(false)
    expect(geometryCache.get('/parkiller.stl')).toBe(geometryAfterAttempt2)
  })

  it('does not abort anything when the first attempt succeeds well within the watchdog window', async () => {
    const { calls, pending } = installFetchMock()
    const { loadWithRetry, geometryCache } = await import('../src/scene/useRobustSTL')

    loadWithRetry('/parkiller.stl', 1)
    pending[0].resolve({ ok: true, arrayBuffer: () => Promise.resolve(emptyBinarySTLBuffer()) })
    await flush()

    expect(calls).toHaveLength(1)
    expect(calls[0].signal.aborted).toBe(false)
    expect(geometryCache.get('/parkiller.stl')).toBeDefined()

    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + RETRY_BASE_DELAY_MS)
    await flush()
    expect(calls).toHaveLength(1)
  })

  it('a genuine HTTP failure still retries with a cache-busting URL, same as before this fix', async () => {
    const { calls, pending } = installFetchMock()
    const { loadWithRetry } = await import('../src/scene/useRobustSTL')

    loadWithRetry('/parkiller.stl', 1)
    pending[0].resolve({ ok: false, status: 500, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })
    await flush()

    await vi.advanceTimersByTimeAsync(RETRY_BASE_DELAY_MS)
    await flush()
    expect(calls).toHaveLength(2)
    expect(calls[1].url).toBe('/parkiller.stl?retry=2')
  })

  it('applies the Z-up-to-Y-up correction pipeline to the parsed geometry (unchanged from before this fix)', async () => {
    const { pending } = installFetchMock()
    const { loadWithRetry, geometryCache } = await import('../src/scene/useRobustSTL')

    loadWithRetry('/parkiller-rotation-check.stl', 1)
    pending[0].resolve({ ok: true, arrayBuffer: () => Promise.resolve(emptyBinarySTLBuffer()) })
    await flush()

    const geometry = geometryCache.get('/parkiller-rotation-check.stl')
    expect(geometry).toBeDefined()
    // Still going through the same rotateX(-PI/2)/recenter pipeline `loadWithRetry` always ran -
    // a bounding box is present, confirming `computeBoundingBox()` executed on the fetched-and-
    // parsed geometry rather than skipping straight to caching raw parsed data.
    expect(geometry!.boundingBox).not.toBeNull()
  })
})
