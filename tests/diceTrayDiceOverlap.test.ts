import { describe, expect, it } from 'vitest'
import { BLACK_ANCHOR_DX, BLACK_ANCHOR_DZ, CORNER_X, CORNER_Z, DIE_SIZE, DIE_SPACING, ROW_SPACING } from '../src/scene/DiceMesh'

// Reported directly, with a screenshot, after the black die's own column/row had already been
// re-tuned twice for OTHER reasons (clearing the window edge, then clearing the track) - each of
// those rounds re-measured its own concern against real data, but "clear of the two white dice"
// had stayed an eyeballed check since the very first L-shape layout, using a rule of thumb (needs
// >= DIE_SIZE/DIE_SPACING columns of separation) that silently stopped holding once row became a
// second real degree of freedom: two same-size, axis-aligned dice only clear each other if EITHER
// axis alone has a full DIE_SIZE of separation between their centers, not some partial combination
// of both - see DiceMesh.tsx's own CORNER_X/CORNER_Z comment for the full writeup of the column
// -0.8/row 0.45 spot that violated exactly this (dx=1.12, dz=1.69, both under DIE_SIZE) despite
// having been re-verified clear of the track and the window edge just before shipping. This test was
// originally the missing third check, pinned directly against the real per-die geometry using that
// same single-axis-only model.
//
// Reported an eighth time, moved to sit under BOTH white dice at once (see DiceMesh.tsx's own
// BLACK_ANCHOR_DX/DZ comment) - a position that, unlike every one before it, deliberately clears
// diagonally (neither axis alone reaches a full DIE_SIZE) rather than along one axis. The single-
// axis-only model this test used would flag that position as overlapping even though real
// screenshots, zoomed tight on the actual rendered contact point, show a clean gap - a rounded
// box's own corner radius cuts real material out of exactly the diagonal a dual-axis offset
// approaches from, so two rounded dice clear each other diagonally at a smaller center-to-center
// distance than two sharp-cornered squares would need to. Switched to the Euclidean center-to-
// center distance instead, calibrated directly against real screenshots at several candidate
// pulls (not derived from the rounding geometry itself): ~0.8x DIE_SIZE still read as touching or
// borderline, ~1.28x DIE_SIZE (this file's own shipped position) read as a clean, comfortable gap
// every time. This model is also strictly looser than the old one for a single-axis-clear position
// (Euclidean distance is never less than either individual axis), so it still passes every earlier
// round's own already-verified spot, not just this one.
//
// column/row mirror the exact <DiceMesh black column={...} row={...}> props in BoardScene.tsx, and
// BLACK_ANCHOR_DX/DZ mirror DiceMesh.tsx's own black-die-only pull off CORNER_X/CORNER_Z - keep all
// four in sync if that JSX or DiceMesh.tsx's own constants ever change, or this test is checking a
// stale position.
const BLACK_DIE_COLUMN = 0
const BLACK_DIE_ROW = 0.85
const WHITE_DIE_COLUMNS = [-0.5, 0.5]
// A comfortable floor, not the bare minimum that would technically clear - calibrated above
// against real screenshots, not just derived from DIE_SIZE. Real measured Euclidean distance at
// this exact position is ~3.75 world units (~1.28x DIE_SIZE) vs both white dice.
const MIN_COMFORTABLE_CLEARANCE = 0.3

function diePosition(column: number, row: number, isBlack: boolean): [number, number] {
  return [
    CORNER_X + column * DIE_SPACING - (isBlack ? BLACK_ANCHOR_DX : 0),
    CORNER_Z + row * ROW_SPACING - (isBlack ? BLACK_ANCHOR_DZ : 0),
  ]
}

describe('the black die tray position clears both white dice by a comfortable center-to-center distance', () => {
  it.each(WHITE_DIE_COLUMNS)('clears the white die at column=%s with real margin', (whiteColumn) => {
    const [blackX, blackZ] = diePosition(BLACK_DIE_COLUMN, BLACK_DIE_ROW, true)
    const [whiteX, whiteZ] = diePosition(whiteColumn, 0, false)
    const centerDistance = Math.hypot(blackX - whiteX, blackZ - whiteZ)

    const clearance = centerDistance - DIE_SIZE
    expect(clearance).toBeGreaterThanOrEqual(MIN_COMFORTABLE_CLEARANCE)
  })
})
