import { describe, expect, it } from 'vitest'
import { turnHandoffDelayMs } from '../src/hooks/turnHandoffDelay'

// See turnHandoffDelayMs's own doc comment (src/hooks/turnHandoffDelay.ts) for the bug this pins
// down: a real local 2-player recording caught the turn banner/dice flipping to the next player
// while the previous move's own hop was still visibly playing on screen, because
// useTurnManager.ts's turnStarted handler held every different-player handoff back by the same
// flat base hold regardless of how long that move's own hop animation (amount*hopDurationMs, plus
// a capture's own bounce-home time) actually needs.
describe('turnHandoffDelayMs', () => {
  const BASE_HOLD_MS = 3000
  const HOP_DURATION_MS = 480
  const CAPTURE_RETURN_HOPS = 3

  it('holds for the flat base delay when the move is short enough that its own hop finishes well within it', () => {
    // amount=3 -> 3*480=1440ms, comfortably under the 3000ms base hold.
    expect(turnHandoffDelayMs(BASE_HOLD_MS, 3, HOP_DURATION_MS, false, CAPTURE_RETURN_HOPS)).toBe(BASE_HOLD_MS)
  })

  it('stretches the hold past the flat base delay for a long combined-dice move (the exact 3-and-6-combined-into-9 recorded bug)', () => {
    // amount=9 (a rolled 3 and 6 combined into one move) -> 9*480=4320ms, longer than the flat
    // 3000ms hold - the real recording showed the turn banner/dice flip to the next player at the
    // flat 3000ms mark, a beat before the piece's own hop (needing 4320ms) had actually finished.
    // This assertion fails against the old flat-TURN_CHANGE_HOLD_MS behavior (which would return
    // 3000 here) and only passes once the delay is budgeted from the move's own real hop time.
    expect(turnHandoffDelayMs(BASE_HOLD_MS, 9, HOP_DURATION_MS, false, CAPTURE_RETURN_HOPS)).toBe(9 * HOP_DURATION_MS)
    expect(turnHandoffDelayMs(BASE_HOLD_MS, 9, HOP_DURATION_MS, false, CAPTURE_RETURN_HOPS)).toBeGreaterThan(BASE_HOLD_MS)
  })

  it("budgets the extra capture-return-hops bounce on top of the move's own hop time when the move captured", () => {
    // amount=2 alone (2*480=960ms) would stay under the base hold, but a capturing move also needs
    // CAPTURE_RETURN_HOPS*hopDurationMs (3*480=1440ms) more for the captured piece's own
    // bounce-home flight to finish - 960+1440=2400ms, still under 3000ms here, so the base hold
    // still wins.
    expect(turnHandoffDelayMs(BASE_HOLD_MS, 2, HOP_DURATION_MS, true, CAPTURE_RETURN_HOPS)).toBe(BASE_HOLD_MS)

    // amount=6 with a capture: 6*480=2880ms own hop + 3*480=1440ms bounce = 4320ms, now longer than
    // both the flat base hold AND amount=6's own hop time alone (2880ms) - proving the capture
    // bounce budget is genuinely added on top, not ignored.
    const withCapture = turnHandoffDelayMs(BASE_HOLD_MS, 6, HOP_DURATION_MS, true, CAPTURE_RETURN_HOPS)
    expect(withCapture).toBe(6 * HOP_DURATION_MS + CAPTURE_RETURN_HOPS * HOP_DURATION_MS)
    expect(withCapture).toBeGreaterThan(turnHandoffDelayMs(BASE_HOLD_MS, 6, HOP_DURATION_MS, false, CAPTURE_RETURN_HOPS))
  })

  it('never returns less than the base hold, even for a zero-length move', () => {
    expect(turnHandoffDelayMs(BASE_HOLD_MS, 0, HOP_DURATION_MS, false, CAPTURE_RETURN_HOPS)).toBe(BASE_HOLD_MS)
  })
})
