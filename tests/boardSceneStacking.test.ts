import { describe, expect, it } from 'vitest'
import { BOARD_DEFINITIONS } from '../src/data/boards'
import { estimateSquareSize } from '../src/scene/boardGeometry'
import { PIECE_BASE_RADIUS } from '../src/scene/PieceMesh'
import { PARKILLER_FOOTPRINT_RADIUS } from '../src/scene/ParkillerMesh'
import { localStackOffset, PARKILLER_SHARED_SQUARE_WIDTH_MULTIPLIER, STACK_OFFSETS, STACK_SAFE_WIDTH_MULTIPLIER, tileColorFor } from '../src/scene/BoardScene'

// Reported directly, with screenshots: 2 barrier pawns and the opposing Parki they legally
// coexist with on a safe square (PK4) rendered piled together with no visible separation, read as
// "3 fichas en una casilla" (a real rules violation) even though the underlying state was correct
// - PARKILLER_SHARED_SQUARE_WIDTH_MULTIPLIER (BoardScene.tsx) exists specifically to give the
// Parki - far bigger than a pawn - real room to separate from them. This locks that fix in with
// real per-board numbers, not just a visual check, so a future change that quietly reverts the
// Parki back to the pawns' own (much tighter) STACK_SAFE_WIDTH_MULTIPLIER regresses loudly here
// instead of only in a screenshot report.
//
// Not a claim that this achieves *zero* overlap everywhere - see PARKILLER_SHARED_SQUARE_WIDTH_
// MULTIPLIER's own doc comment: real piece/tile proportions on the tightest boards leave too
// little room for that without growing tiles further (risking the tile's own drawn border again)
// or shrinking pieces (already explicitly rejected by the client). This only asserts the Parki
// ends up meaningfully farther from the pawns than the old, pawn-only multiplier would have placed
// it - a real, checkable floor under any future regression, not a promise of full separation.
describe('BoardScene stacking - a Parki sharing a safe square with pawns', () => {
  it('separates further from co-located pawns than the pawns\' own (much tighter) multiplier would', () => {
    for (const playerCount of [2, 3, 4, 5, 6]) {
      const def = BOARD_DEFINITIONS[playerCount]
      const tileSize = estimateSquareSize(def.trackWaypoints)

      // Mirrors BoardScene.tsx's own Parki call site exactly: STACK_OFFSETS[2] (the group's 3rd
      // occupant, in insertion order - pawns are always added before the Parki), along axis never
      // widened, across axis widened by the multiplier under test.
      const [along, across] = STACK_OFFSETS[2 % STACK_OFFSETS.length]
      const withFix = localStackOffset(null, -1, along, across, tileSize, tileSize * PARKILLER_SHARED_SQUARE_WIDTH_MULTIPLIER, PARKILLER_FOOTPRINT_RADIUS)
      const withOldPawnMultiplier = localStackOffset(null, -1, along, across, tileSize, tileSize * STACK_SAFE_WIDTH_MULTIPLIER, PARKILLER_FOOTPRINT_RADIUS)

      const fixDistance = Math.hypot(...withFix)
      const oldDistance = Math.hypot(...withOldPawnMultiplier)

      expect(fixDistance, `board_${playerCount}p`).toBeGreaterThan(oldDistance)
      // A pawn sits at STACK_OFFSETS[0]/[1], ~0.1*tileSize from center on each axis - sanity check
      // the Parki's own new distance from center clears at least a bare pawn radius past that, on
      // every board (a much lower bar than full non-overlap, but enough to catch a gross regression
      // like the multiplier accidentally being set below 1, which would make this worse, not better).
      const pawnDistanceFromCenter = Math.hypot(0.1 * tileSize, 0.1 * tileSize)
      expect(fixDistance, `board_${playerCount}p`).toBeGreaterThan(pawnDistanceFromCenter + PIECE_BASE_RADIUS)
    }
  })
})

// Reported directly, over a real tester session ("sigue sin aparecer el tablero" / "en mi
// ordenador no sale el tablero"), with a screenshot showing pieces and dice rendering normally
// over a completely blank board: trackTiles (BoardScene.tsx) used to `return []` outright whenever
// the board's own color sampler hadn't resolved yet - useBoardColorSampler.ts's own doc comment
// already flagged this exact risk. Every tile now gets a real fallback color instead, via this
// pulled-out pure function - pinned directly here so a future change can't quietly reintroduce the
// empty-array path without a rendering harness ever catching it.
describe('tileColorFor', () => {
  it('falls back to a real color (not sampled from the board art) while the sampler is not ready', () => {
    const color = tileColorFor(null, [0.3, 0.4], false)
    expect(color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('still emphasizes a safe square even on the fallback color, same as a real sampled one', () => {
    const plain = tileColorFor(null, [0.3, 0.4], false)
    const safe = tileColorFor(null, [0.3, 0.4], true)
    expect(safe).not.toBe(plain)
  })

  it('uses the real sampled color once the sampler is ready, not the fallback', () => {
    const sampler = () => '#123456'
    expect(tileColorFor(sampler, [0.1, 0.9], false)).toBe('#123456')
  })
})
