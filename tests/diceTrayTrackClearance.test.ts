import { describe, expect, it } from 'vitest'
import { BOARD_DEFINITIONS } from '../src/data/boards'
import { estimateSquareSize, toWorldPosition } from '../src/scene/boardGeometry'
import { SAFE_TILE_WIDTH_MULTIPLIER } from '../src/scene/BoardScene'
import { CORNER_X, CORNER_Z, DIE_SIZE, DIE_SPACING, ROW_SPACING } from '../src/scene/DiceMesh'

// Reported directly, over several rounds, about the dice tray sitting in the board's bottom-right
// corner (the closest gap to a track square): first that it overlapped the track outright, then -
// after fixing that by eye on a few boards - that it still did on others, then - after fixing THAT
// by measuring every board's own real waypoint data - that the black die specifically (moved twice
// more since, first to clear an overlap with the white pair, then to read as genuinely sitting
// underneath them) had drifted back onto the track, this time because clearing the *window* edge
// and clearing the *track* are two different checks and only the first one had actually been
// re-verified after those two moves. This test is the second check, pinned directly: the black
// die's own real-world position (its exact column/row offset from the white pair, computed the
// same way BoardScene.tsx positions it) must clear every track/corridor tile's own half-width -
// protected squares at their full SAFE_TILE_WIDTH_MULTIPLIER width, same as the tile mesh itself
// renders - on every board, with a real margin, not just barely.
//
// column/row mirror the exact <DiceMesh black column={...} row={...}> props in BoardScene.tsx -
// keep these in sync if that JSX ever changes, or this test is checking a stale position.
const BLACK_DIE_COLUMN = -1.6
const BLACK_DIE_ROW = 0.85
// A comfortable floor, not the bare minimum that would technically clear - see this file's own
// doc comment above for why "technically positive" (0.78 world units, measured directly against
// the very column/row this replaced) still read as touching once actually rendered.
const MIN_COMFORTABLE_CLEARANCE = 1.5

function blackDieWorldPosition(): [number, number] {
  return [CORNER_X + BLACK_DIE_COLUMN * DIE_SPACING, CORNER_Z + BLACK_DIE_ROW * ROW_SPACING]
}

describe('the black die tray position clears every track tile on every board', () => {
  it.each([2, 3, 4, 5, 6])('board_%ip: clears every track tile by at least %s world units', (playerCount) => {
    const definition = BOARD_DEFINITIONS[playerCount]
    const tileSize = estimateSquareSize(definition.trackWaypoints)
    const safeSet = new Set(definition.safeTrackIndices)
    const [dieX, dieZ] = blackDieWorldPosition()
    const dieHalfWidth = DIE_SIZE / 2

    let minClearance = Infinity
    definition.trackWaypoints.forEach((waypoint, i) => {
      const [tileX, , tileZ] = toWorldPosition(waypoint)
      const tileHalfWidth = (tileSize / 2) * (safeSet.has(i) ? SAFE_TILE_WIDTH_MULTIPLIER : 1)
      const centerDistance = Math.hypot(tileX - dieX, tileZ - dieZ)
      const clearance = centerDistance - tileHalfWidth - dieHalfWidth
      minClearance = Math.min(minClearance, clearance)
    })

    expect(minClearance).toBeGreaterThanOrEqual(MIN_COMFORTABLE_CLEARANCE)
  })
})
