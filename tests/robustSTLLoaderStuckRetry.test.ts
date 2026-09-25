import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Same fix, same bug, as tests/robustAssetLoaderStuckRetry.test.ts's own doc comment describes for
// useRobustTexture.ts - the user's own screenshot also showed parkiller.stl stuck as `(canceled)`.
// This exercises useRobustSTL.ts's own `armStuckRetryWatchdog`.

const LOAD_TIMEOUT_MS = 10_000
const STUCK_RETRY_MS = LOAD_TIMEOUT_MS * 1.5

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

async function flush(times = 8) {
  for (let i = 0; i < times; i++) {
    await vi.advanceTimersByTimeAsync(0)
  }
}

describe('useRobustSTL - armStuckRetryWatchdog recovers a chain that stopped advancing', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('starts a fresh attempt if the url is still uncached after STUCK_RETRY_MS, even with no pending timer driving it', async () => {
    const { calls } = installFetchMock()
    const { armStuckRetryWatchdog, inFlight } = await import('../src/scene/useRobustSTL')

    inFlight.set('/parkiller.stl', new Set())
    const timer = armStuckRetryWatchdog('/parkiller.stl')
    expect(calls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(STUCK_RETRY_MS)
    await flush()

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/parkiller.stl')
    clearTimeout(timer)
  })

  it('does nothing if the geometry is already cached by the time STUCK_RETRY_MS elapses', async () => {
    const { pending } = installFetchMock()
    const { loadWithRetry, armStuckRetryWatchdog, geometryCache, inFlight } = await import('../src/scene/useRobustSTL')

    inFlight.set('/parkiller.stl', new Set())
    loadWithRetry('/parkiller.stl', 1)
    const timer = armStuckRetryWatchdog('/parkiller.stl')

    pending[0].resolve({ ok: true, arrayBuffer: () => Promise.resolve(emptyBinarySTLBuffer()) })
    await flush()
    expect(geometryCache.get('/parkiller.stl')).toBeDefined()

    const { calls } = installFetchMock()
    await vi.advanceTimersByTimeAsync(STUCK_RETRY_MS)
    await flush()

    expect(calls).toHaveLength(0)
    clearTimeout(timer)
  })

  it('clearing the returned timer (an unmount, in the real hook) prevents it from ever firing', async () => {
    const { calls } = installFetchMock()
    const { armStuckRetryWatchdog, inFlight } = await import('../src/scene/useRobustSTL')

    inFlight.set('/parkiller.stl', new Set())
    const timer = armStuckRetryWatchdog('/parkiller.stl')
    clearTimeout(timer)

    await vi.advanceTimersByTimeAsync(STUCK_RETRY_MS * 2)
    await flush()

    expect(calls).toHaveLength(0)
  })
})
