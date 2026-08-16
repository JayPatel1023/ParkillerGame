import type { BoardDefinition } from '../core/board/boardDefinition'
import type { Piece, PieceSnapshot } from '../core/pieces/piece'

export function getPieceWaypoint(piece: Piece, definition: BoardDefinition): [number, number] | null {
  const lane = definition.playerLanes.find((l) => l.color === piece.color)
  if (!lane) return null

  switch (piece.state) {
    case 'InYard':
      return lane.yardWaypoints[piece.pieceIndex] ?? null
    case 'OnTrack':
      return definition.trackWaypoints[piece.trackPosition] ?? null
    case 'InHomeCorridor':
      return lane.homeCorridorWaypoints[piece.corridorPosition] ?? null
    case 'Finished':
      return lane.homeCorridorWaypoints[lane.homeCorridorWaypoints.length - 1] ?? null
    default:
      return null
  }
}


// No legitimate single move produces anywhere near this many hops. Two dice cap a normal move at
// 12 (double sixes), but a capture/finish reward (PC 5) legitimately moves a piece up to 20
// squares in one go (see CAPTURE_REWARD in turnManager.ts) - confirmed directly as the cause of
// reward moves occasionally collapsing to a single instant jump instead of animating hop-by-hop:
// the old ceiling of 20 didn't leave room for a 20-square reward that also crosses into the home
// corridor, tipping it just over the limit. Sized well above that (20 reward + longest corridor)
// while staying far below a full lap on even the smallest board (51 on the 3p board), so a genuine
// runaway reconstruction is still caught.
const MAX_PLAUSIBLE_HOPS = 32

function finalWaypoint(color: Piece['color'], snapshot: PieceSnapshot, definition: BoardDefinition): [number, number] | null {
  const lane = definition.playerLanes.find((l) => l.color === color)
  if (!lane) return null
  if (snapshot.state === 'OnTrack') return definition.trackWaypoints[snapshot.trackPosition] ?? null
  if (snapshot.state === 'InHomeCorridor' || snapshot.state === 'Finished') return lane.homeCorridorWaypoints[snapshot.corridorPosition] ?? null
  return null
}

// Reconstructs the square-by-square path a piece actually walked for one move, so the animation
// can hop through every intermediate square instead of gliding straight from A to B. The number
// of hops always equals the dice roll, since ParchisRules moves exactly one index per pip.
export function getHopWaypoints(
  color: Piece['color'],
  before: PieceSnapshot,
  after: PieceSnapshot,
  definition: BoardDefinition,
): [number, number][] {
  const lane = definition.playerLanes.find((l) => l.color === color)
  if (!lane) return []

  if (before.state === 'InYard') {
    const entry = definition.trackWaypoints[lane.entryTrackIndex]
    return entry ? [entry] : []
  }

  const hops: [number, number][] = []

  // A piece that landed exactly on its own home-entrance square on an earlier turn sits there
  // still OnTrack (parchisRules only switches it to InHomeCorridor once a later roll actually
  // carries it past that square) - moving again from that exact spot needs zero track hops before
  // falling through to the corridor loop below. Without this check, the walk below starts by
  // stepping *past* index `before.trackPosition` and won't see it again as a break condition until
  // it's walked every other square on the loop and wrapped back around - reproduced directly: a
  // piece at trackPosition 50 (== its own homeEntranceTrackIndex) moving 2 into the corridor
  // produced 58 phantom hops around the full loop before the real 2-hop corridor entry.
  if (before.state === 'OnTrack' && before.trackPosition !== lane.homeEntranceTrackIndex) {
    const trackLength = definition.trackWaypoints.length
    let i = before.trackPosition
    let guard = 0
    while (guard++ <= trackLength) {
      i = (i + 1) % trackLength
      const wp = definition.trackWaypoints[i]
      if (wp) hops.push(wp)
      if (after.state === 'OnTrack' && i === after.trackPosition) return hops
      if (i === lane.homeEntranceTrackIndex) break
    }
  }

  const fromCorridor = before.state === 'InHomeCorridor' ? before.corridorPosition : -1
  for (let c = fromCorridor + 1; c <= after.corridorPosition; c++) {
    const wp = lane.homeCorridorWaypoints[c]
    if (wp) hops.push(wp)
  }

  // Belt-and-suspenders: some rare before/after combination still occasionally produces a
  // full-loop-length reconstruction that hasn't been pinned down despite extensive testing (pure
  // logic simulation across all 5 boards, and live rapid-interaction stress tests). Whatever the
  // trigger, a piece visibly circling the entire board is a far worse failure than a plain glide -
  // fall back to a single direct hop straight to the real destination so the game state stays
  // correct (it always was - this only ever affected the animation) without the runaway visual.
  if (hops.length > MAX_PLAUSIBLE_HOPS) {
    const dest = finalWaypoint(color, after, definition)
    return dest ? [dest] : hops.slice(-1)
  }

  return hops
}

// A captured piece's own state flips to InYard the instant the capturing move is submitted (see
// captureAt in parchisRules.ts) - reconstructing "the path it walked" the way getHopWaypoints does
// makes no sense here, since it didn't walk anywhere, it got sent back. A few direct hops in a
// straight line from the capture square to its own yard slot read as "flung home" instead.
const CAPTURE_RETURN_HOPS = 3

export function getCaptureReturnWaypoints(
  color: Piece['color'],
  captureTrackPosition: number,
  pieceIndex: number,
  definition: BoardDefinition,
): [number, number][] {
  const lane = definition.playerLanes.find((l) => l.color === color)
  const from = definition.trackWaypoints[captureTrackPosition]
  const to = lane?.yardWaypoints[pieceIndex]
  if (!lane || !from || !to) return []

  const hops: [number, number][] = []
  for (let i = 1; i <= CAPTURE_RETURN_HOPS; i++) {
    const t = i / CAPTURE_RETURN_HOPS
    hops.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t])
  }
  return hops
}

/** Null once eliminated (PK6) - it's simply not rendered anywhere from that point on. */
export function getParkillerWaypoint(trackPosition: number, state: 'InPlay' | 'Eliminated', definition: BoardDefinition): [number, number] | null {
  if (state !== 'InPlay') return null
  return definition.trackWaypoints[trackPosition] ?? null
}

// Same square-by-square reconstruction as getHopWaypoints, but walking the shared track loop
// backward (decreasing index) instead of forward - PK3: the Parkiller moves clockwise, opposite
// every regular piece's counterclockwise direction, and it only ever moves along this one shared
// loop (no yard/corridor of its own to enter), so this is simpler than the regular-piece version.
export function getParkillerHopWaypoints(before: number, after: number, definition: BoardDefinition): [number, number][] {
  const trackLength = definition.trackWaypoints.length
  const hops: [number, number][] = []
  let i = before
  let guard = 0
  while (i !== after && guard++ <= trackLength) {
    i = (i - 1 + trackLength) % trackLength
    const wp = definition.trackWaypoints[i]
    if (wp) hops.push(wp)
  }
  return hops
}
