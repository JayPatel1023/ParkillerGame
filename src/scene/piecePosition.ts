import type { BoardDefinition } from '../core/board/boardDefinition'
import type { Piece, PieceState } from '../core/pieces/piece'

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

export interface PieceSnapshot {
  state: PieceState
  trackPosition: number
  corridorPosition: number
}

export function snapshotPiece(piece: Piece): PieceSnapshot {
  return { state: piece.state, trackPosition: piece.trackPosition, corridorPosition: piece.corridorPosition }
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

  if (before.state === 'OnTrack') {
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

  return hops
}
