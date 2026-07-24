export const BOARD_SIZE = 6
export const BASE_HEIGHT = 0.16

/** Maps a normalized [0..1] board-image coordinate to a world position on the flat board plane. */
export function toWorldPosition([u, v]: [number, number], height = BASE_HEIGHT): [number, number, number] {
  return [(u - 0.5) * BOARD_SIZE, height, (v - 0.5) * BOARD_SIZE]
}

/**
 * Real square size varies per board (a 6-player board packs in noticeably more, smaller squares
 * than a 2-player one), so a fixed world-unit offset for spreading stacked pieces looks fine on
 * one board and has them overlapping/spilling into neighboring squares on another. Estimate the
 * board's actual square size from its own waypoint spacing instead of assuming one fixed value.
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
