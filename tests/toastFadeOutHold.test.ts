import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastFadeOutTracker, type ToastDisplayState } from '../src/hooks/toastFadeOutHold'

// See ToastFadeOutTracker's own doc comment (src/hooks/toastFadeOutHold.ts) - the plain timer
// class RewardToast.tsx's own fade-out is built on, pulled out specifically so this behavior is
// directly testable without a React-component-rendering harness (this project has none).
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ToastFadeOutTracker', () => {
  it('show() reports the content immediately, not exiting', () => {
    const changes: (ToastDisplayState<string> | null)[] = []
    const tracker = new ToastFadeOutTracker<string>((state) => changes.push(state), 300)

    tracker.show('+10 ¡Meta!')

    expect(changes).toEqual([{ content: '+10 ¡Meta!', exiting: false }])
  })

  it('hide() keeps reporting the last content, flagged exiting, until fadeOutMs elapses - then reports null', () => {
    const changes: (ToastDisplayState<string> | null)[] = []
    const tracker = new ToastFadeOutTracker<string>((state) => changes.push(state), 300)

    tracker.show('+10 ¡Meta!')
    tracker.hide('+10 ¡Meta!')

    // Immediately after hide(): still showing the real content, not a blank/unmounted toast -
    // this is the whole point (the old code unmounted synchronously right here instead).
    expect(changes).toEqual([
      { content: '+10 ¡Meta!', exiting: false },
      { content: '+10 ¡Meta!', exiting: true },
    ])

    vi.advanceTimersByTime(299)
    expect(changes).toHaveLength(2)

    vi.advanceTimersByTime(1)
    expect(changes).toEqual([
      { content: '+10 ¡Meta!', exiting: false },
      { content: '+10 ¡Meta!', exiting: true },
      null,
    ])
  })

  it('a fresh show() mid-fade cancels the pending clear and re-enters fully opaque, not exiting', () => {
    const changes: (ToastDisplayState<string> | null)[] = []
    const tracker = new ToastFadeOutTracker<string>((state) => changes.push(state), 300)

    tracker.show('+10 ¡Captura!')
    tracker.hide('+10 ¡Captura!')
    vi.advanceTimersByTime(200) // still mid-fade, well before the 300ms clear would fire

    tracker.show('+20 ¡Parki eliminado!') // a second event lands before the first one's fade finished

    // The 300ms timer from the first hide() must not fire and clear the toast out from under the
    // second event's own entrance.
    vi.advanceTimersByTime(200) // t=400 overall, past the first hide()'s original 300ms deadline
    expect(changes.at(-1)).toEqual({ content: '+20 ¡Parki eliminado!', exiting: false })
  })

  it('dispose cancels a running fade with no trailing onChange(null) call', () => {
    const changes: (ToastDisplayState<string> | null)[] = []
    const tracker = new ToastFadeOutTracker<string>((state) => changes.push(state), 300)

    tracker.show('+10 ¡Meta!')
    tracker.hide('+10 ¡Meta!')
    tracker.dispose()

    vi.advanceTimersByTime(1000)
    expect(changes).toEqual([
      { content: '+10 ¡Meta!', exiting: false },
      { content: '+10 ¡Meta!', exiting: true },
    ])
  })
})
