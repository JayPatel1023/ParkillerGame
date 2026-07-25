export const BOARD_SIZE = 6
export const BASE_HEIGHT = 0.16

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
