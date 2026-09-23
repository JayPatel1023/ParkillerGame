import { describe, expect, it } from 'vitest'
import { computeAwaitingRewardChoice } from '../src/ui/GameBoardScreen'

// Bug found by close video review of a real local recording (b1_0451.jpg): with a reward already
// chosen and its piece visibly hopping forward square by square, the turn-status header stayed
// frozen on "Elija una ficha para su recompensa" for the whole ~10-12s of that animation, instead
// of updating the instant the choice was actually made. Root cause: the header used to read
// visiblePendingReward - a useHeldAlert-derived value purpose-built to keep RewardToast/
// RewardBurst legible for a while after the real reward goes null - rather than a live snapshot of
// whether a reward choice is genuinely still open right now. computeAwaitingRewardChoice
// (GameBoardScreen.tsx) is the fix: a plain, ungated derivation with no hold, mirroring how
// visiblePendingMoves (same file) already tracks its own live equivalent.
describe('computeAwaitingRewardChoice - GameBoardScreen turn-status header', () => {
  const baseGating = { isMyTurn: true, rolling: false, animationsSettled: true, paused: false }

  it('shows the reward choice while one is genuinely still open (baseline, unchanged behavior)', () => {
    const pendingReward = { reason: 'capture' as const }
    expect(computeAwaitingRewardChoice({ ...baseGating, pendingReward })).toBe(pendingReward)
  })

  it('stops showing the reward choice the instant it is made, even though a held/toast value for the same event would still be truthy', () => {
    // Mirrors submitMove's real, synchronous effect (useTurnManager.ts's moveApplied handler):
    // choosing the reward piece nulls the raw pendingReward AND starts that piece's own move
    // animation in the same tick, so animationsSettled flips to false at the same instant. A
    // held/toast-style value (useHeldAlert) would still be returning the stale grant here for its
    // full hold window - this is exactly the case that used to leak into the header.
    expect(
      computeAwaitingRewardChoice({
        isMyTurn: true,
        rolling: false,
        animationsSettled: false, // the reward piece's own move animation just started
        paused: false,
        pendingReward: null, // submitMove already nulled the raw value synchronously
      }),
    ).toBeNull()
  })

  it('never shows the reward choice on someone else\'s turn, mid-roll, or while paused, even if a reward is technically pending', () => {
    const pendingReward = { reason: 'finish' as const }
    expect(computeAwaitingRewardChoice({ ...baseGating, isMyTurn: false, pendingReward })).toBeNull()
    expect(computeAwaitingRewardChoice({ ...baseGating, rolling: true, pendingReward })).toBeNull()
    expect(computeAwaitingRewardChoice({ ...baseGating, paused: true, pendingReward })).toBeNull()
  })

  it('returns null when there is no pending reward at all', () => {
    expect(computeAwaitingRewardChoice({ ...baseGating, pendingReward: null })).toBeNull()
  })
})
