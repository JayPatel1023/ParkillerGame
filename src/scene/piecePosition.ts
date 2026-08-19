import type { BoardDefinition } from '../core/board/boardDefinition'
import type { PieceColor } from '../core/pieceColor'
import type { Piece, PieceSnapshot } from '../core/pieces/piece'
import type { Parkiller } from '../core/pieces/parkiller'

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
// 12 (double sixes); a capture/finish reward (PC 5) legitimately moves a piece up to REWARD_UNIT
// (10, in turnManager.ts - a capture is two independent 10-square moves, never one 20-square move)
// squares in one go - confirmed directly as the cause of reward moves occasionally collapsing to a
// single instant jump instead of animating hop-by-hop: an earlier, lower ceiling didn't leave room
// for a reward move that also crosses into the home corridor, tipping it just over the limit.
// Sized well above the actual max (10 reward + longest corridor) while staying far below a full
// lap on even the smallest board (51 on the 3p board), so a genuine runaway reconstruction is
// still caught.
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

// PK1: the rulebook places the Parkiller "at the finish square in the center of the board" before
// its first move, not out on the main loop - reused directly as its pre-move rest/hop-origin
// coordinate, since it's already the exact per-color center-area point the corridor art converges
// on (no new board data needed). Equivalent to parkillerCorridorWaypoint(color, 0, definition).
export function parkillerCenterWaypoint(color: PieceColor, definition: BoardDefinition): [number, number] | null {
  const lane = definition.playerLanes.find((l) => l.color === color)
  return lane?.homeCorridorWaypoints[lane.homeCorridorWaypoints.length - 1] ?? null
}

// The waypoint for a Parkiller that has crossed exactly `corridorPosition` of its own lane's home
// corridor squares, walking from the center (0, the lane's own last corridor waypoint) toward the
// loop (corridorPosition === the lane's own corridorLength lands on the home-entrance track square
// itself, one past the corridor - callers should use trackWaypoints directly at that point instead,
// since corridorPosition can legitimately keep counting past corridorLength once further loop
// movement has happened, only the crossing moment itself is >= corridorLength).
export function parkillerCorridorWaypoint(color: PieceColor, corridorPosition: number, definition: BoardDefinition): [number, number] | null {
  const lane = definition.playerLanes.find((l) => l.color === color)
  if (!lane) return null
  const index = lane.homeCorridorWaypoints.length - 1 - corridorPosition
  return lane.homeCorridorWaypoints[index] ?? null
}

/** Null once eliminated (PK6) - it's simply not rendered anywhere from that point on. Still
 * crossing its own lane's home corridor (corridorPosition < corridorLength - see that field's own
 * doc comment)? Renders at the matching corridor waypoint instead of trackPosition, which is stale/
 * meaningless until fully crossed. */
export function getParkillerWaypoint(parkiller: Parkiller, definition: BoardDefinition): [number, number] | null {
  if (parkiller.state !== 'InPlay') return null
  if (parkiller.corridorPosition < parkiller.corridorLength) {
    const wp = parkillerCorridorWaypoint(parkiller.color, parkiller.corridorPosition, definition)
    if (wp) return wp
  }
  return definition.trackWaypoints[parkiller.trackPosition] ?? null
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

/** One combined position - both fields always meaningful together, see Parkiller's own fields. */
export interface ParkillerPosition {
  trackPosition: number
  corridorPosition: number
}

// Reconstructs a Parkiller's actual hop-by-hop path for one roll, covering any mix of: still
// crossing its own lane's home corridor, crossing fully onto the loop this roll, or already being
// on the loop (a plain getParkillerHopWaypoints walk). The client's own explicit, repeated
// instruction settled this: the corridor is walked one real square at a time, spending the black
// die itself (see Parkiller.corridorPosition and resolveParkillerMove in turnManager.ts) - not an
// extra distance layered on top of it (three earlier attempts - instant jump, sped-up walk, smooth
// glide - all still covered corridorLength + dieValue and got rejected every time as not matching
// the die: "한발자국을 움직여야하는데 8+1=9발자국갔다").
export function getParkillerMoveHopWaypoints(
  color: PieceColor,
  before: ParkillerPosition,
  after: ParkillerPosition,
  definition: BoardDefinition,
): [number, number][] {
  const lane = definition.playerLanes.find((l) => l.color === color)
  if (!lane) return []
  const corridorLength = lane.homeCorridorWaypoints.length
  const hops: [number, number][] = []

  // Every corridor square actually crossed this roll (none at all once already past the corridor).
  const corridorHopsEnd = Math.min(after.corridorPosition, corridorLength)
  for (let crossed = before.corridorPosition + 1; crossed <= corridorHopsEnd; crossed++) {
    const wp = parkillerCorridorWaypoint(color, crossed, definition)
    if (wp) hops.push(wp)
  }

  if (after.corridorPosition < corridorLength) return hops // didn't reach the loop this roll at all

  if (before.corridorPosition < corridorLength) {
    // This is the roll that crosses - the entrance square itself is a real hop here (never one in
    // the normal case, since hopFrom already sits right there once past the corridor).
    const entranceWaypoint = definition.trackWaypoints[lane.homeEntranceTrackIndex]
    if (entranceWaypoint) hops.push(entranceWaypoint)
    hops.push(...getParkillerHopWaypoints(lane.homeEntranceTrackIndex, after.trackPosition, definition))
  } else {
    // Already fully on the loop before this roll even started - a plain loop walk.
    hops.push(...getParkillerHopWaypoints(before.trackPosition, after.trackPosition, definition))
  }

  return hops
}
