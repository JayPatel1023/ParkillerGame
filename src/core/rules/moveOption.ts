import type { Piece } from '../pieces/piece'

export type MoveKind = 'ExitYard' | 'TrackMove' | 'CorridorMove' | 'FinishMove'

// Which of this roll's two dice (or their sum) this option would spend - set by TurnManager, not
// by getValidMoves itself (which only knows the raw step count, not where it came from). 'reward'
// marks a bonus move spending an earned reward (PC 5) rather than a die - it doesn't consume dieA/
// dieB and, per the rulebook, can only ever apply to a piece already in play (getValidMoves already
// excludes InYard pieces here for free: its ExitYard branch requires amount === settings.exitRoll,
// which a reward amount never coincidentally equals).
export type DiceSource = 'dieA' | 'dieB' | 'sum' | 'reward'

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
