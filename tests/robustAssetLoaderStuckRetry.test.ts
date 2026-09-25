import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Reported directly, with DevTools Network-tab screenshots, reproducing specifically when clicking
// through the setup screens very fast right after the app loads: board_4p.webp/tile-fill.png/
// tile-border.png requests sitting as `(canceled)` with nothing after them - a retry that got
// aborted (loadWithRetry's own watchdog does this deliberately, to supersede a hung attempt) but
// then genuinely never got a next attempt going, because the gap between one attempt aborting and
// the next actually starting is a bare, uncancellable `setTimeout` with nothing watching it. See
// useRobustTexture.ts's own STUCK_RETRY_MS doc comment for the full root-cause writeup. This pins
// the safety net itself: `armStuckRetryWatchdog` (pulled out of the hook's effect purely so it's
// testable without a rendering harness, matching robustAssetLoaderAbort.test.ts's own pattern).

const STUCK_RETRY_MS = 20_000

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

describe('useRobustTexture - armStuckRetryWatchdog recovers a chain that stopped advancing', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    class FakeImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('Image', FakeImage)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('starts a fresh attempt if the url is still uncached after STUCK_RETRY_MS, even with no pending timer driving it', async () => {
    const { calls } = installFetchMock()
    const { armStuckRetryWatchdog, inFlight } = await import('../src/scene/useRobustTexture')

    // Simulates the exact reported failure: some earlier chain left `inFlight` marked as in
    // progress with nothing actually scheduled (no loadWithRetry call at all here) - the
    // watchdog must not depend on that chain's own state to notice nothing is happening.
    inFlight.set('/board.webp', new Set())
    const timer = armStuckRetryWatchdog('/board.webp')
    expect(calls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(STUCK_RETRY_MS)
    await flush()

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/board.webp')
    clearTimeout(timer)
  })

  it('does nothing if the texture is already cached by the time STUCK_RETRY_MS elapses', async () => {
    const { calls, pending } = installFetchMock()
    const { loadWithRetry, armStuckRetryWatchdog, textureCache, inFlight } = await import('../src/scene/useRobustTexture')

    inFlight.set('/board.webp', new Set())
    loadWithRetry('/board.webp', 1)
    const timer = armStuckRetryWatchdog('/board.webp')

    pending[0].resolve({ ok: true, blob: () => Promise.resolve('blob-1') })
    await flush()
    expect(textureCache.get('/board.webp')).toBeDefined()

    await vi.advanceTimersByTimeAsync(STUCK_RETRY_MS)
    await flush()

    // Only the original attempt's fetch happened - the watchdog found the cache already
    // populated and did not start a redundant one.
    expect(calls).toHaveLength(1)
    clearTimeout(timer)
  })

  it('clearing the returned timer (an unmount, in the real hook) prevents it from ever firing', async () => {
    const { calls } = installFetchMock()
    const { armStuckRetryWatchdog, inFlight } = await import('../src/scene/useRobustTexture')

    inFlight.set('/board.webp', new Set())
    const timer = armStuckRetryWatchdog('/board.webp')
    clearTimeout(timer)

    await vi.advanceTimersByTimeAsync(STUCK_RETRY_MS * 2)
    await flush()

    expect(calls).toHaveLength(0)
  })
})
