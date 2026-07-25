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
 */
export function computeTileCorners(worldPoints: [number, number][], i: number, halfWidth: number): [number, number][] {
  const n = worldPoints.length
  const prev = worldPoints[(i - 1 + n) % n]
  const cur = worldPoints[i]
  const next = worldPoints[(i + 1) % n]

  const perpOf = (ax: number, ay: number, bx: number, by: number): [number, number] => {
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1e-9
    return [(-dy / len) * halfWidth, (dx / len) * halfWidth]
  }

  const prevMid: [number, number] = [(prev[0] + cur[0]) / 2, (prev[1] + cur[1]) / 2]
  const nextMid: [number, number] = [(cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2]
  const [ppx, ppy] = perpOf(prev[0], prev[1], cur[0], cur[1])
  const [npx, npy] = perpOf(cur[0], cur[1], next[0], next[1])

  return [
    [prevMid[0] + ppx, prevMid[1] + ppy],
    [prevMid[0] - ppx, prevMid[1] - ppy],
    [nextMid[0] - npx, nextMid[1] - npy],
    [nextMid[0] + npx, nextMid[1] + npy],
  ]
}
