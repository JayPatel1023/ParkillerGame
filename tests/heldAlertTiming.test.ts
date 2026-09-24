import { describe, expect, it } from 'vitest'
import { heldAlertClearDelayMs } from '../src/ui/heldAlertTiming'

// See heldAlertTiming.ts - the dice used to reset to their default face while a piece was still
// hopping ("왜 벌써 주사위는 제자리로 돌아가 얼마만큼 움직여야 하는지 알 수 없게 하니").
describe('heldAlertClearDelayMs', () => {
  const base = { elapsedMs: 0, holdMs: 3800, lingerMs: 1500, msSinceUnblocked: 0, blocked: false }

  it('never schedules a clear while animations are still running (the piece is still hopping)', () => {
    // Even with the minimum hold long since used up - the exact case that wiped the dice mid-move.
    expect(heldAlertClearDelayMs({ ...base, elapsedMs: 60_000, blocked: true })).toBeNull()
  })

  it('keeps the numbers up for a linger after the piece lands, even if the minimum hold already ran out', () => {
    expect(heldAlertClearDelayMs({ ...base, elapsedMs: 60_000, msSinceUnblocked: 0 })).toBe(1500)
    expect(heldAlertClearDelayMs({ ...base, elapsedMs: 60_000, msSinceUnblocked: 1000 })).toBe(500)
  })

  it('clears immediately once both the minimum hold and the linger are used up', () => {
    expect(heldAlertClearDelayMs({ ...base, elapsedMs: 60_000, msSinceUnblocked: 5000 })).toBe(0)
  })

  it('still honors the original minimum hold when it is the longer of the two', () => {
    expect(heldAlertClearDelayMs({ ...base, elapsedMs: 1000, msSinceUnblocked: 5000 })).toBe(2800)
  })

  it('behaves exactly as before for callers with no linger and no blocking (toasts)', () => {
    expect(heldAlertClearDelayMs({ elapsedMs: 1000, holdMs: 3000, lingerMs: 0, msSinceUnblocked: 0, blocked: false })).toBe(2000)
    expect(heldAlertClearDelayMs({ elapsedMs: 9000, holdMs: 3000, lingerMs: 0, msSinceUnblocked: 0, blocked: false })).toBe(0)
  })
})
