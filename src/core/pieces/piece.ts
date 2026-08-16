import type { PieceColor } from '../pieceColor'

export type PieceState = 'InYard' | 'OnTrack' | 'InHomeCorridor' | 'Finished'

export interface Piece {
  color: PieceColor
  pieceIndex: number
  state: PieceState
  trackPosition: number
  corridorPosition: number
}

export function createPiece(color: PieceColor, pieceIndex: number): Piece {
  return {
    color,
    pieceIndex,
    state: 'InYard',
    trackPosition: -1,
    corridorPosition: -1,
  }
}

/** Just enough of a Piece's position to reconstruct where it was before/after a move (see
 * scene/piecePosition.ts's getHopWaypoints) - lives here rather than in scene/ since TurnManager
 * itself needs to take a "before" snapshot the instant a move is submitted, and core/ can't
 * depend on scene/ (see CLAUDE.md's layering). */
export interface PieceSnapshot {
  state: PieceState
  trackPosition: number
  corridorPosition: number
}

export function snapshotPiece(piece: Piece): PieceSnapshot {
  return { state: piece.state, trackPosition: piece.trackPosition, corridorPosition: piece.corridorPosition }
}
