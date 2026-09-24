// Where each occupant of a shared square stands, in *world* x/z offsets from the square's own
// center - worked out against the default camera (looking from +z toward -z) instead of the
// tile's own along/across axes.
//
// Reported directly ("hay que corregir el problema de visión cuando en una misma casilla están un
// parki y un peón. No se diferencian bien" - the pawn and the Parki sharing a square can't be told
// apart): with tile-local offsets, whether the pawn ended up beside the Parki or hidden directly
// behind its cloak depended on which way that particular tile happens to run across the screen, and
// the Parki (twice a pawn's height) easily swallowed the pawn. Here the pawn always stands in FRONT
// (toward the camera) and off to one side of the Parki, so it is never occluded, while the taller
// Parki stays readable above and behind it; two pawns or two Parkis stand side by side along the
// screen's horizontal axis, where neither can hide the other.
//
// Sized off the two footprint radii, so the spacing follows any future size change. Deliberately not
// clamped to the tile: on the tightest (6-player) board a pawn+Parki pair spills a little past the
// tile's drawn border, which the client accepted in preference to the two figures merging into one.

export interface StackRadii {
  pawn: number
  parkiller: number
}

const isParkiller = (id: string) => id.startsWith('parkiller-')

/** Offset [dx, dz] for `occupantId` within `group` (every occupant of that square, pawns first as
 * BoardScene builds it), or null when the group has a composition this layout doesn't cover
 * (callers fall back to the tile-local offsets). */
export function screenStackOffset(group: string[], occupantId: string, radii: StackRadii): [number, number] | null {
  const pawns = group.filter((id) => !isParkiller(id))
  const parkis = group.filter(isParkiller)
  const r = radii.pawn
  const R = radii.parkiller
  const pawnSlot = pawns.indexOf(occupantId)
  const parkiSlot = parkis.indexOf(occupantId)
  if (pawnSlot < 0 && parkiSlot < 0) return null
  // -1 = left, +1 = right, in the order the occupants were added (stable between renders).
  const side = (slot: number, count: number) => (count === 1 ? 0 : slot === 0 ? -1 : 1)

  if (pawns.length === 2 && parkis.length === 0) return [side(pawnSlot, 2) * 0.95 * r, 0]
  if (pawns.length === 0 && parkis.length === 2) return [side(parkiSlot, 2) * 0.95 * R, 0]
  if (pawns.length === 1 && parkis.length === 1) return pawnSlot === 0 ? [1.2 * r, 0.8 * r] : [-0.4 * R, -0.45 * R]
  if (pawns.length === 2 && parkis.length === 1) return pawnSlot >= 0 ? [side(pawnSlot, 2) * 0.95 * r, 0.8 * r] : [0, -0.8 * R]
  if (pawns.length === 1 && parkis.length === 2) return pawnSlot >= 0 ? [0, 0.9 * r] : [side(parkiSlot, 2) * 0.95 * R, -0.5 * R]
  return null
}
