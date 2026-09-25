import { describe, expect, it } from 'vitest'
import { CORNER_X, CORNER_Z, DIE_SIZE, DIE_SPACING, ROW_SPACING } from '../src/scene/DiceMesh'

// Reported directly, with a screenshot, after the black die's own column/row had already been
// re-tuned twice for OTHER reasons (clearing the window edge, then clearing the track) - each of
// those rounds re-measured its own concern against real data, but "clear of the two white dice"
// had stayed an eyeballed check since the very first L-shape layout, using a rule of thumb (needs
// >= DIE_SIZE/DIE_SPACING columns of separation) that silently stopped holding once row became a
// second real degree of freedom: two same-size, axis-aligned dice only clear each other if EITHER
// axis alone has a full DIE_SIZE of separation between their centers, not some partial combination
// of both - see DiceMesh.tsx's own CORNER_X/CORNER_Z comment for the full writeup of the column
// -0.8/row 0.45 spot that violated exactly this (dx=1.12, dz=1.69, both under DIE_SIZE) despite
// having been re-verified clear of the track and the window edge just before shipping. This test is
// the missing third check, pinned directly against the real per-die geometry.
//
// column/row mirror the exact <DiceMesh black column={...} row={...}> props in BoardScene.tsx -
// keep these in sync if that JSX ever changes, or this test is checking a stale position.
const BLACK_DIE_COLUMN = -1.6
const BLACK_DIE_ROW = 0.85
const WHITE_DIE_COLUMNS = [-0.5, 0.5]
// A comfortable floor, not the bare minimum that would technically clear - matches
// diceTrayTrackClearance.test.ts's own MIN_COMFORTABLE_CLEARANCE reasoning: "technically positive"
// has already read as touching once actually rendered, twice, in this exact file's own history.
const MIN_COMFORTABLE_CLEARANCE = 0.5

function diePosition(column: number, row: number): [number, number] {
  return [CORNER_X + column * DIE_SPACING, CORNER_Z + row * ROW_SPACING]
}

describe('the black die tray position clears both white dice by a full axis of separation', () => {
  it.each(WHITE_DIE_COLUMNS)('clears the white die at column=%s by at least DIE_SIZE on one axis, with margin', (whiteColumn) => {
    const [blackX, blackZ] = diePosition(BLACK_DIE_COLUMN, BLACK_DIE_ROW)
    const [whiteX, whiteZ] = diePosition(whiteColumn, 0)
    const dx = Math.abs(blackX - whiteX)
    const dz = Math.abs(blackZ - whiteZ)

    // AABB non-overlap for two axis-aligned, equal-size boxes needs ONE full axis of separation -
    // a partial gap on both axes at once (the actual shape of the -0.8/0.45 regression) still
    // overlaps regardless of how large either individual gap looks in isolation.
    const bestAxisClearance = Math.max(dx, dz) - DIE_SIZE
    expect(bestAxisClearance).toBeGreaterThanOrEqual(MIN_COMFORTABLE_CLEARANCE)
  })
})
