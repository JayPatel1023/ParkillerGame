import type { Piece } from '../pieces/piece'

export type MoveKind = 'ExitYard' | 'TrackMove' | 'CorridorMove' | 'FinishMove'

export interface MoveOption {
  piece: Piece
  kind: MoveKind
  resultingTrackPosition: number
  resultingCorridorPosition: number
}

export interface MoveResult {
  movedPiece: Piece
  capturedPiece: Piece | null
  pieceFinished: boolean
}
