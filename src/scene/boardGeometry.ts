export const BOARD_SIZE = 6

/** Maps a normalized [0..1] board-image coordinate to a world position on the flat board plane. */
export function toWorldPosition([u, v]: [number, number], height = 0.16): [number, number, number] {
  return [(u - 0.5) * BOARD_SIZE, height, (v - 0.5) * BOARD_SIZE]
}
