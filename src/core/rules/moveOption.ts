import type { Piece } from '../pieces/piece'

export type MoveKind = 'ExitYard' | 'TrackMove' | 'CorridorMove' | 'FinishMove'

// Which of this roll's two dice (or their sum) this option would spend - set by TurnManager, not
// by getValidMoves itself (which only knows the raw step count, not where it came from).
export type DiceSource = 'dieA' | 'dieB' | 'sum'

export interface MoveOption {
  piece: Piece
  kind: MoveKind
  resultingTrackPosition: number
  resultingCorridorPosition: number
  amount: number
  diceSource: DiceSource
}

export interface MoveResult {
  movedPiece: Piece
  capturedPiece: Piece | null
  pieceFinished: boolean
}
