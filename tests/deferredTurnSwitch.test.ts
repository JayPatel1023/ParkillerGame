import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeferredTurnSwitchTracker } from '../src/hooks/deferredTurnSwitch'

// See DeferredTurnSwitchTracker's own doc comment (src/hooks/deferredTurnSwitch.ts) - the plain
// timer class useTurnManager.ts's own different-player turnStarted branch is built on, pulled out
// specifically so this "only switch once BOTH the hold has elapsed AND animations are settled"
// behavior is directly testable without a React hook-testing harness (this project has none - see
// captureFlightHold.test.ts's own matching comment).
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DeferredTurnSwitchTracker', () => {
  it('switches right at the given hold when animations are already settled (unchanged pacing for an ordinary short move)', () => {
    const onSwitch = vi.fn()
    const tracker = new DeferredTurnSwitchTracker<string>(onSwitch)

    tracker.schedule('Red', 3000)
    vi.advanceTimersByTime(2999)
    expect(onSwitch).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onSwitch).toHaveBeenCalledTimes(1)
    expect(onSwitch).toHaveBeenCalledWith('Red')
  })

  it('does NOT switch once the hold elapses while animations are still unsettled - only once they actually clear', () => {
    const onSwitch = vi.fn()
    const tracker = new DeferredTurnSwitchTracker<string>(onSwitch)

    // A long reward move (or anything the hold's own estimate undershot) is still visibly
    // hopping - the exact real-recording bug this fixes (b2.mp4, ~t=352s): the header/avatar must
    // not flip to the incoming player while that's still true, no matter how long it takes.
    tracker.setAnimationsSettled(false)
    tracker.schedule('Red', 3000)

    vi.advanceTimersByTime(3000)
    expect(onSwitch).not.toHaveBeenCalled()

    vi.advanceTimersByTime(5000) // well past the hold - still mid-hop
    expect(onSwitch).not.toHaveBeenCalled()

    // The outgoing piece's own hop animation finally finishes.
    tracker.setAnimationsSettled(true)
    expect(onSwitch).toHaveBeenCalledTimes(1)
    expect(onSwitch).toHaveBeenCalledWith('Red')
  })

  it('switches immediately once animations settle, even if that happens after the hold already elapsed', () => {
    const onSwitch = vi.fn()
    const tracker = new DeferredTurnSwitchTracker<string>(onSwitch)

    tracker.setAnimationsSettled(false)
    tracker.schedule('Blue', 3000)
    vi.advanceTimersByTime(3000)
    expect(onSwitch).not.toHaveBeenCalled()

    tracker.setAnimationsSettled(true)
    expect(onSwitch).toHaveBeenCalledTimes(1)

    // A stray extra settle call afterwards must not re-fire the same switch.
    tracker.setAnimationsSettled(false)
    tracker.setAnimationsSettled(true)
    expect(onSwitch).toHaveBeenCalledTimes(1)
  })

  it('a later schedule supersedes an earlier one still waiting on its own hold - only the newest target ever switches', () => {
    const onSwitch = vi.fn()
    const tracker = new DeferredTurnSwitchTracker<string>(onSwitch)

    tracker.schedule('Red', 3000)
    vi.advanceTimersByTime(1000)
    tracker.schedule('Blue', 3000) // e.g. a chain of forfeited rolls handing off again before Red's own hold fired

    vi.advanceTimersByTime(2999)
    expect(onSwitch).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onSwitch).toHaveBeenCalledTimes(1)
    expect(onSwitch).toHaveBeenCalledWith('Blue')
  })

  it('dispose cancels a pending switch with no trailing onSwitch call', () => {
    const onSwitch = vi.fn()
    const tracker = new DeferredTurnSwitchTracker<string>(onSwitch)

    tracker.schedule('Red', 3000)
    tracker.dispose()

    vi.advanceTimersByTime(5000)
    expect(onSwitch).not.toHaveBeenCalled()
  })
})
