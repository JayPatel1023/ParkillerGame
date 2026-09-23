import { describe, expect, it } from 'vitest'
import { computeAwaitingMoveChoice } from '../src/ui/GameBoardScreen'

// Bug found by close video review of a real local recording (b2_0248.jpg, sandwiched between
// b2_0247.jpg and b2_0249.jpg): with a piece choice genuinely still open the whole time - dice
// values, pawn positions and the roll button's own state all identical across the three frames -
// the turn-status header flickered from "Elija una ficha para mover" to the stale "Dados: X y Y ·
// Parkiller: Z" line and back, for a single frame. Root cause: the header used to read
// visiblePendingMoves.length > 0 - a value deliberately ANDed with animationsSettled so a piece
// can't be *selected* mid-animation (see visiblePendingMoves's own comment in GameBoardScreen.tsx)
// - so any momentary rolling/animationsSettled dip, even one with no visible on-screen animation
// at all, emptied it for a tick and the header fell through to the stale, held visibleRoll case.
// computeAwaitingMoveChoice (GameBoardScreen.tsx) is the fix: a plain, live snapshot gated only on
// what the header text actually needs (isMyTurn, !rolling, !paused), mirroring
// computeAwaitingRewardChoice's own fix for the sibling reward-choice text.
describe('computeAwaitingMoveChoice - GameBoardScreen turn-status header', () => {
  const baseGating = { isMyTurn: true, rolling: false, paused: false }

  it('shows the move choice while one is genuinely still open (baseline, unchanged behavior)', () => {
    const pendingMoves = [{ piece: 'p1', amount: 5 }]
    expect(computeAwaitingMoveChoice({ ...baseGating, pendingMoves })).toEqual(pendingMoves)
  })

  it('does not empty out on a momentary animationsSettled-only blip - pendingMoves itself is unchanged', () => {
    // Mirrors the exact real-recording case: dice, pawns and the pending choice are all still
    // there, only some other animation-tracking flag (moveAnimation/parkillerAnimation/
    // captureFlightPending, all folded into animationsSettled in GameBoardScreen.tsx) dipped for a
    // single tick with nothing visibly happening. Unlike visiblePendingMoves, this function takes
    // no animationsSettled parameter at all, so it has no way to be sensitive to that dip.
    const pendingMoves = [{ piece: 'p1', amount: 5 }]
    expect(computeAwaitingMoveChoice({ ...baseGating, pendingMoves })).toEqual(pendingMoves)
    // Same inputs again - the point is there is no hidden animationsSettled-shaped input that
    // could have flipped this to empty in between real state changes.
    expect(computeAwaitingMoveChoice({ ...baseGating, pendingMoves })).toEqual(pendingMoves)
  })

  it('never shows the move choice on someone else\'s turn, mid-roll, or while paused, even with pending moves', () => {
    const pendingMoves = [{ piece: 'p1', amount: 5 }]
    expect(computeAwaitingMoveChoice({ ...baseGating, isMyTurn: false, pendingMoves })).toEqual([])
    expect(computeAwaitingMoveChoice({ ...baseGating, rolling: true, pendingMoves })).toEqual([])
    expect(computeAwaitingMoveChoice({ ...baseGating, paused: true, pendingMoves })).toEqual([])
  })

  it('returns an empty array when there are no pending moves at all', () => {
    expect(computeAwaitingMoveChoice({ ...baseGating, pendingMoves: [] })).toEqual([])
  })
})
