// Reported directly ("말들의 크기를 작게하지말고... 원래의 크기를 가지고 한칸에 들어가게" - don't
// shrink the pieces, fit them in one square at their real size): two full-size pieces sharing a
// square (a barrier, or the Parkiller landing on a pawn) previously didn't both fit inside a track
// tile without either overlapping or spilling past its border on the tightest board (6-player,
// tile ~0.22 world units) - see BoardScene.tsx's own CROWDED_SCALE history for the shrink-based fix
// this replaces. Rather than shrinking the *pieces* (inconsistent size, the actual complaint) or
// the Parkiller specifically (its "clearly bigger than a pawn" sizing was itself an earlier
// explicit request), this grows the *board* instead - tiles scale directly with this constant
// (see toWorldPosition/estimateSquareSize below), while every piece's own size is a fixed absolute
// world-unit constant completely unrelated to it, and FitBoardCamera's own distance depends only on
// viewport size, not this constant - so growing it doesn't need any compensating zoom-out, it
// simply gives full-size pieces more real room. 9.7 is the exact tileSize needed for the tightest
// board's worst case (Parkiller + pawn, both at their current unmodified radii) to fit with zero
// overlap and zero tile-edge overspill - rounded up to 10 for a small margin.
//
// Bumped again, 10 -> 12, alongside a matching PIECE_BASE_RADIUS increase (see PieceMesh.tsx):
// reported directly that pieces now read as too small against the bigger board ("말들의 크기가
// 너무작다"). Growing pieces without growing the board back out from under them would have eaten
// straight back into the zero-overlap margin above, so both grow together, keeping the same ~3%
// margin ratio (12 / (9.7 * 1.2) ~= 1.03, matching 10/9.7's own ratio) rather than re-introducing
// the crowding bug this constant was originally raised to fix.
//
// Bumped a third time, 12 -> 17, again paired with PIECE_BASE_RADIUS: still reported as too small,
// this time pointing at a yard piece specifically dwarfed by its own yard-hole artwork. Given a
// bigger jump than the previous round's exact-margin approach (~14.9 would exactly match the old
// ~3% margin at the new radius) specifically for more breathing room this time, so a same-size
// future request doesn't come right back to "barely fits."
//
// Bumped a fourth time, 17 -> 18, alongside another small PIECE_BASE_RADIUS increase - reported
// directly, again, as still too small.
//
// Bumped a fifth time, 18 -> 22, alongside PIECE_BASE_RADIUS - reported directly, again, as still
// too small. BoardScene's own localStackOffset now also clamps a shared square's stacking offset
// directly against the live piece/Parkiller footprint radius (not just a fixed fraction of tile
// size, which was the actual cause of a separately-reported "stepping on the tile's own border
// line" bug at this same size), so further growth here no longer risks reopening that one on its
// own - this bump is purely about the "still too small" ask. 22 rather than a straight 20 (the
// previous round's own proportional bump) specifically gives that clamp enough real tile size to
// also keep a pawn+Parkiller pair (the bigger of the two possible shared-square combinations, and
// notably bigger than a same-size pawn+pawn barrier) from overlapping each other while both still
// individually clear the tile's own border.
//
// Bumped a sixth time, 22 -> 24, alongside PIECE_BASE_RADIUS - reported directly, again, as still
// too small.
//
// Bumped a seventh time, 24 -> 28, alongside PIECE_BASE_RADIUS's own bigger 0.13 -> 0.15 jump -
// reported directly, again, as still too small.
//
// Bumped an eighth time, 28 -> 32, alongside PIECE_BASE_RADIUS - reported directly, again, as
// still too small.
//
// Bumped a ninth time, 32 -> 41, alongside PIECE_BASE_RADIUS's own bigger 0.17 -> 0.22 jump -
// reported directly, again, as still too small.
export const BOARD_SIZE = 41
// Just enough clearance above TrackTile's own surface (which itself sits at this same height - see
// TrackTile.tsx) to avoid z-fighting between a piece's base and the tile underneath it. Only
// correct for pieces actually standing on a raised TrackTile, i.e. OnTrack - see FLAT_SURFACE_HEIGHT
// for every other state.
export const BASE_HEIGHT = 0.02

// Yard, home-corridor, and finished-hub squares have no TrackTile mesh at all (confirmed via edge
// detection on the source art - see HomeCorridorDebugPath's own comment) - a piece resting there
// sits directly over the flat board plane at y=0, not a raised tile, so it doesn't need BASE_HEIGHT's
// clearance and using it anyway left these pieces visibly hovering above their own square (reported
// directly as pieces "floating in space", worst at close/low camera angles where the gap reads as
// large relative to the piece's own footprint). Small enough to still dodge z-fighting with the flat
// board texture, nowhere near tall enough to read as a gap.
export const FLAT_SURFACE_HEIGHT = 0.003

/** Maps a normalized [0..1] board-image coordinate to a world position on the flat board plane. */
export function toWorldPosition([u, v]: [number, number], height = BASE_HEIGHT): [number, number, number] {
  return [(u - 0.5) * BOARD_SIZE, height, (v - 0.5) * BOARD_SIZE]
}

/**
 * Real square size varies per board (a 6-player board packs in noticeably more, smaller squares
 * than a 2-player one). Estimate it from the board's own waypoint spacing instead of assuming one
 * fixed value, so a repeated tile component sizes itself correctly for whichever board is loaded.
 */
export function estimateSquareSize(trackWaypoints: [number, number][]): number {
  if (trackWaypoints.length < 2) return BOARD_SIZE * 0.05
  const gaps: number[] = []
  for (let i = 0; i < trackWaypoints.length; i++) {
    const a = trackWaypoints[i]
    const b = trackWaypoints[(i + 1) % trackWaypoints.length]
    gaps.push(Math.hypot(a[0] - b[0], a[1] - b[1]))
  }
  gaps.sort((x, y) => x - y)
  const median = gaps[Math.floor(gaps.length / 2)]
  return median * BOARD_SIZE
}

/**
 * The 4 world-space corners of the trapezoid a track square actually is on a curved path (wider
 * on the outside of the curve, narrower on the inside) - not a rigid square, which would leave
 * gaps or overlaps between neighbors on any curve. Each tile's boundary is the midpoint between it
 * and its neighbor, using that same neighbor-pair's direction for the perpendicular offset, so
 * tile `i`'s far edge is computed identically to tile `i+1`'s near edge and the two always meet
 * exactly - no per-tile size/gap tuning needed.
 *
 * At a sharp bend (some boards have real waypoints that turn 90-150 degrees between consecutive
 * segments), a tile's own near-edge and far-edge perpendiculars can point in different enough
 * directions that the naive quad self-intersects into a "bowtie" - two of its edges cross, which
 * renders as a dark sliver artifact right at that square, confirmed visually on several boards.
 * When that's detected, blend to a single shared perpendicular for both of this tile's edges
 * instead (still simple, non-self-intersecting) - trading a barely-visible seam at that one sharp
 * corner for not rendering a visible glitch there.
 */
export function computeTileCorners(worldPoints: [number, number][], i: number, halfWidth: number): [number, number][] {
  const n = worldPoints.length
  const prev = worldPoints[(i - 1 + n) % n]
  const cur = worldPoints[i]
  const next = worldPoints[(i + 1) % n]

  const dirOf = (ax: number, ay: number, bx: number, by: number): [number, number] => {
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1e-9
    return [dx / len, dy / len]
  }
  const perpFromDir = (dx: number, dy: number): [number, number] => [-dy * halfWidth, dx * halfWidth]

  const prevMid: [number, number] = [(prev[0] + cur[0]) / 2, (prev[1] + cur[1]) / 2]
  const nextMid: [number, number] = [(cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2]
  const dirIn = dirOf(prev[0], prev[1], cur[0], cur[1])
  const dirOut = dirOf(cur[0], cur[1], next[0], next[1])

  // Below ~60 degrees of turn, the two raw perpendiculars are safe to use as-is (this is the
  // common case, and using each edge's own direction is what makes neighboring tiles meet
  // exactly). Past that, blend toward one shared direction for this tile only.
  const cosAngle = dirIn[0] * dirOut[0] + dirIn[1] * dirOut[1]
  const sharpTurn = cosAngle < 0.5

  let ppx: number, ppy: number, npx: number, npy: number
  if (sharpTurn) {
    const blend: [number, number] = [dirIn[0] + dirOut[0], dirIn[1] + dirOut[1]]
    const blendLen = Math.hypot(blend[0], blend[1]) || 1e-9
    const shared = perpFromDir(blend[0] / blendLen, blend[1] / blendLen)
    ;[ppx, ppy] = shared
    ;[npx, npy] = shared
  } else {
    ;[ppx, ppy] = perpFromDir(dirIn[0], dirIn[1])
    ;[npx, npy] = perpFromDir(dirOut[0], dirOut[1])
  }

  return [
    [prevMid[0] + ppx, prevMid[1] + ppy],
    [prevMid[0] - ppx, prevMid[1] - ppy],
    [nextMid[0] - npx, nextMid[1] - npy],
    [nextMid[0] + npx, nextMid[1] + npy],
  ]
}
