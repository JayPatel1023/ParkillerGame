import { describe, expect, it } from 'vitest'
import { computeAnimationsSettledForPendingMoves } from '../src/ui/GameBoardScreen'

// Bug found by close video review of a real local recording (b2.mp4, ~t=106-119s, two-player
// hotseat, Red's turn): with a piece choice genuinely still open the whole window - dice values,
// pawn positions and every button state identical throughout, no piece ever completing a new hop
// - visiblePendingMoves/canRoll (GameBoardScreen.tsx) kept collapsing and re-appearing three times
// over ~13 seconds (a piece's own selectable glow and the TIRAR DADOS button both flickering off
// and back on), purely because animationsSettled kept flipping back to false off some EARLIER,
// unrelated capture's own captureFlightPending retrigger (see useTurnManager.ts's own
// CaptureFlightHoldTracker.trigger()) - nothing about the actual choice on screen had changed.
// computeAnimationsSettledForPendingMoves (GameBoardScreen.tsx) is the fix: see its own doc
// comment there for the full mechanism.
describe('computeAnimationsSettledForPendingMoves - GameBoardScreen piece-choice/roll-button reveal latch', () => {
  it('waits for a genuine settle on the very first call (no previous state yet)', () => {
    const pendingMoves = ['choice-a']
    expect(computeAnimationsSettledForPendingMoves(undefined, pendingMoves, false)).toEqual({
      pendingMoves,
      settled: false,
    })
    expect(computeAnimationsSettledForPendingMoves(undefined, pendingMoves, true)).toEqual({
      pendingMoves,
      settled: true,
    })
  })

  it('latches settled=true once revealed, and does not re-mask it when animationsSettled dips again for the SAME pendingMoves reference', () => {
    const pendingMoves = ['choice-a']
    let state = computeAnimationsSettledForPendingMoves(undefined, pendingMoves, false)
    expect(state.settled).toBe(false)

    // Animations finish settling - the choice is now genuinely revealed.
    state = computeAnimationsSettledForPendingMoves(state, pendingMoves, true)
    expect(state.settled).toBe(true)

    // The exact bug this fixes: some OTHER, unrelated capture's own trailing edge re-arms
    // captureFlightPending, flipping the raw animationsSettled back to false - but `pendingMoves`
    // itself never changed, so the already-revealed choice must stay revealed.
    state = computeAnimationsSettledForPendingMoves(state, pendingMoves, false)
    expect(state.settled).toBe(true)

    // Can flip false/true/false/true repeatedly (mirrors the recording's own 3x oscillation) and
    // still never re-masks the same, already-revealed choice.
    state = computeAnimationsSettledForPendingMoves(state, pendingMoves, true)
    expect(state.settled).toBe(true)
    state = computeAnimationsSettledForPendingMoves(state, pendingMoves, false)
    expect(state.settled).toBe(true)
  })

  it('still waits for a genuine settle on a brand new pendingMoves reference - a fresh reveal is not fast-tracked', () => {
    const firstChoice = ['choice-a']
    let state = computeAnimationsSettledForPendingMoves(undefined, firstChoice, true)
    expect(state.settled).toBe(true)

    // A real new roll/move resolving hands back a fresh array (useTurnManager.ts's own
    // setPendingMoves([])/setPendingMoves(moves) calls) - even though the previous choice had
    // already latched settled=true, this new one must wait on animationsSettled again, same as
    // before this fix, so a piece still can't become selectable ahead of its own animation.
    const secondChoice = ['choice-b']
    state = computeAnimationsSettledForPendingMoves(state, secondChoice, false)
    expect(state).toEqual({ pendingMoves: secondChoice, settled: false })

    state = computeAnimationsSettledForPendingMoves(state, secondChoice, true)
    expect(state.settled).toBe(true)
  })

  it('treats a different-but-equal-looking array (e.g. two separate [] literals) as a fresh value, not the same reference', () => {
    const emptyA: string[] = []
    const emptyB: string[] = []
    let state = computeAnimationsSettledForPendingMoves(undefined, emptyA, true)
    expect(state.settled).toBe(true)

    // A structurally-identical but distinct array reference (exactly what setPendingMoves([])
    // produces on every call) resets the latch, even though `.length === 0` for both.
    state = computeAnimationsSettledForPendingMoves(state, emptyB, false)
    expect(state).toEqual({ pendingMoves: emptyB, settled: false })
  })

  it('returns the same object reference when nothing changes, so callers never re-render on a no-op', () => {
    const pendingMoves = ['choice-a']
    const settled = computeAnimationsSettledForPendingMoves(undefined, pendingMoves, true)
    const again = computeAnimationsSettledForPendingMoves(settled, pendingMoves, true)
    expect(again).toBe(settled)

    // Same guarantee once the dip-after-reveal case has already latched settled=true.
    const dipped = computeAnimationsSettledForPendingMoves(settled, pendingMoves, false)
    expect(dipped).toBe(settled)
  })
})
