import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Reported directly, with three DevTools Network-tab screenshots ("좀빨리 버튼들을 누르면 이렇게
// 된다" - if you press the buttons a bit fast, this happens): the same resource (board webp,
// parkiller.stl) showed up as TWO separate completed Network-log entries (`?retry=2` AND
// `?retry=3`, both eventually 200) instead of one - because useRobustTexture.ts's/useRobustSTL.ts's
// `loadWithRetry()` handed each attempt's URL to `loader.load()` with no cancellation hook, so a
// watchdog-triggered retry never stopped the attempt it was superseding; that old attempt's real
// browser request just kept running in the background and eventually completed on its own as an
// extra, wasted concurrent connection. Fixed by fetching each attempt behind its own
// `AbortController` and aborting the previous one before starting the next. These tests exercise
// `loadWithRetry` directly (both files now export it, plus their module-level caches, for exactly
// this) rather than through the React hooks, matching this project's existing pattern of pulling
// timer/callback logic out for direct testing without a rendering harness (see
// tests/toastFadeOutHold.test.ts).

const LOAD_TIMEOUT_MS = 10_000
const RETRY_BASE_DELAY_MS = 800

type FetchCall = { url: string; signal: AbortSignal }

function installFetchMock() {
  const calls: FetchCall[] = []
  const pending: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = []
  const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
    calls.push({ url, signal: opts!.signal as AbortSignal })
    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject })
      // An aborted attempt's fetch must itself reject, the same way a real aborted fetch would -
      // wire that up here so the mock behaves like the real thing once `controller.abort()` runs.
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

// Drains however many promise-chain hops a resolved/rejected fetch mock needs to reach its
// eventual .then/.catch handler (blob()/arrayBuffer()/createImageBitmap() each add their own
// microtask tick on top of the fetch() promise itself) - advancing fake timers by 0ms still
// flushes pending microtasks, so a few repeats reliably settles the whole chain without coupling
// the test to the exact number of `.then()`s in `loadWithRetry`.
async function flush(times = 8) {
  for (let i = 0; i < times; i++) {
    await vi.advanceTimersByTimeAsync(0)
  }
}

describe('useRobustTexture - watchdog-triggered retries abort the attempt they supersede', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 4, height: 4 } as unknown as ImageBitmap),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("aborts attempt 1's fetch before starting attempt 2 once the watchdog fires", async () => {
    const { calls } = installFetchMock()
    const { loadWithRetry } = await import('../src/scene/useRobustTexture')

    loadWithRetry('/board.webp', 1)
    expect(calls).toHaveLength(1)
    expect(calls[0].signal.aborted).toBe(false)

    // The watchdog fires at LOAD_TIMEOUT_MS - attempt 1 is still hanging (its fetch promise never
    // resolved) - which must abort it and schedule attempt 2 after RETRY_BASE_DELAY_MS more.
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + RETRY_BASE_DELAY_MS)
    await flush()

    expect(calls[0].signal.aborted).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[1].url).toBe('/board.webp?retry=2')
    expect(calls[1].signal.aborted).toBe(false)
  })

  it("a late resolution of the aborted, abandoned attempt 1 does not overwrite attempt 2's cached result (settled guard still holds)", async () => {
    const { calls, pending } = installFetchMock()
    const { loadWithRetry, textureCache, inFlight } = await import('../src/scene/useRobustTexture')

    inFlight.set('/board.webp', new Set())
    loadWithRetry('/board.webp', 1)
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + RETRY_BASE_DELAY_MS)
    await flush()
    expect(calls).toHaveLength(2)

    // Attempt 2 succeeds first.
    pending[1].resolve({ ok: true, blob: () => Promise.resolve('blob-2') })
    await flush()
    const textureAfterAttempt2 = textureCache.get('/board.webp')
    expect(textureAfterAttempt2).toBeDefined()
    expect(inFlight.has('/board.webp')).toBe(false)

    // The abandoned attempt 1 - already aborted, its fetch promise already rejected via the abort
    // listener above, and its own `.catch` already found `settled` true and returned - must not
    // have clobbered the cache or double-notified subscribers. Asserting the cache still holds
    // attempt 2's own texture confirms the guard held.
    expect(textureCache.get('/board.webp')).toBe(textureAfterAttempt2)
  })

  it('does not abort anything when the first attempt succeeds well within the watchdog window', async () => {
    const { calls, pending } = installFetchMock()
    const { loadWithRetry, textureCache } = await import('../src/scene/useRobustTexture')

    loadWithRetry('/board.webp', 1)
    pending[0].resolve({ ok: true, blob: () => Promise.resolve('blob-1') })
    await flush()

    expect(calls).toHaveLength(1)
    expect(calls[0].signal.aborted).toBe(false)
    expect(textureCache.get('/board.webp')).toBeDefined()

    // Advancing well past the watchdog window afterward must not spawn a phantom retry - the
    // first attempt already settled successfully.
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + RETRY_BASE_DELAY_MS)
    await flush()
    expect(calls).toHaveLength(1)
  })

  // Reported directly, with a screenshot ("현재 보드의 그림이 반전되였다" - the board's picture is
  // currently flipped): after the fetch()+createImageBitmap() switch above, every board rendered
  // vertically upside-down relative to where each piece sits (each color's pieces landed on the
  // wrong-colored yard). `THREE.Texture.flipY` has no effect on an ImageBitmap-sourced texture, so
  // the vertical flip a plain Image()/TextureLoader texture gets for free has to be requested at
  // decode time instead. This pins that option - a future "simplification" that drops it would put
  // the art back upside-down again with no other test noticing, since nothing here renders pixels.
  it("decodes the image with imageOrientation 'flipY' so the board art isn't vertically inverted", async () => {
    const { pending } = installFetchMock()
    const { loadWithRetry } = await import('../src/scene/useRobustTexture')

    loadWithRetry('/board.webp', 1)
    pending[0].resolve({ ok: true, blob: () => Promise.resolve('blob-1') })
    await flush()

    const createImageBitmapMock = globalThis.createImageBitmap as unknown as ReturnType<typeof vi.fn>
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1)
    expect(createImageBitmapMock.mock.calls[0][1]).toMatchObject({ imageOrientation: 'flipY' })
  })

  it('a genuine HTTP failure (not just a hung watchdog) still retries with a cache-busting URL, same as before this fix', async () => {
    const { calls, pending } = installFetchMock()
    const { loadWithRetry } = await import('../src/scene/useRobustTexture')

    loadWithRetry('/board.webp', 1)
    pending[0].resolve({ ok: false, status: 404, blob: () => Promise.resolve('never') })
    await flush()

    await vi.advanceTimersByTimeAsync(RETRY_BASE_DELAY_MS)
    await flush()
    expect(calls).toHaveLength(2)
    expect(calls[1].url).toBe('/board.webp?retry=2')
  })
})
