import type { PieceColor } from '../pieceColor'
import { createPiece, type Piece } from '../pieces/piece'

export interface PlayerState {
  color: PieceColor
  pieces: Piece[]
}

export function createPlayerState(color: PieceColor): PlayerState {
  return {
    color,
    pieces: [0, 1, 2, 3].map((i) => createPiece(color, i)),
  }
}

export function hasWon(player: PlayerState): boolean {
  return player.pieces.every((p) => p.state === 'Finished')
}
