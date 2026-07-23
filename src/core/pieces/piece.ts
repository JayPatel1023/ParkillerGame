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
