import type { BoardDefinition } from '../core/board/boardDefinition'
import type { Piece } from '../core/pieces/piece'

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
