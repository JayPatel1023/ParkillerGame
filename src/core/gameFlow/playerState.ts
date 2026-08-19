import type { BoardData } from '../board/boardData'
import type { PieceColor } from '../pieceColor'
import { createPiece, type Piece } from '../pieces/piece'
import { createParkiller, type Parkiller } from '../pieces/parkiller'

export interface PlayerState {
  color: PieceColor
  pieces: Piece[]
  parkiller: Parkiller
}

export function createPlayerState(color: PieceColor, board: BoardData): PlayerState {
  const lane = board.lanes[color]
  return {
    color,
    pieces: [0, 1, 2, 3].map((i) => createPiece(color, i)),
    parkiller: createParkiller(color, lane?.homeEntranceTrackIndex ?? 0, lane?.corridorLength ?? 0),
  }
}

export function hasWon(player: PlayerState): boolean {
  return player.pieces.every((p) => p.state === 'Finished')
}
