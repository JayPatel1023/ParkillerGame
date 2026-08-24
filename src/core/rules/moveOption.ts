import type { PieceColor } from '../pieceColor'
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
  /** Set when this move landed exactly on an opposing color's Parkiller piece (PK6) - eliminating
   * it permanently, same as capturing a regular piece but tracked separately since a Parkiller has
   * no yard to return to. */
  capturedParkillerColor: PieceColor | null
  pieceFinished: boolean
  /** PK5: set when the *mover itself* landed on an unprotected opposing Parkiller without
   * eliminating it (PK6) - the move still completes, but the arriving pawn is immediately sent
   * back to its own yard instead of staying on the track, with no reward. `movedPiece` reflects
   * this - by the time the caller sees this result, its state is already back to InYard.
   * `eliminatedByParkillerAt`/`eliminatedByParkillerColor` preserve where it landed and whose
   * Parkiller got it - `movedPiece` alone can't say either, since its own trackPosition is already
   * -1 by this point. The scene layer needs both to animate the pawn actually walking there before
   * being sent home, instead of just vanishing (reported directly: "도착하기전에 이미 먹히울걸
   * 타산해서 가기도전에 갑자기 먼저 사라지는" - it disappears before even arriving, as if the game
   * calculated the elimination ahead of time instead of resolving it in order). */
  eliminatedByParkiller?: boolean
  eliminatedByParkillerAt?: number
  eliminatedByParkillerColor?: PieceColor
}
