import type { Piece } from '../pieces/piece'
import type { PieceColor } from '../pieceColor'
import type { MoveOption, MoveResult } from '../rules/moveOption'
import type { DiceRoll, MoveAnimationInfo, ParkillerMoveResult, RewardGrant } from './turnManager'
import type { PlayerState } from './playerState'

/** The read side of TurnManager's own EventEmitter<T> - deliberately without .emit(), so nothing
 * outside gameFlow/ can push fake events onto a real TurnManager's own emitters. */
export interface Listenable<T> {
  on(listener: (value: T) => void): () => void
}

/**
 * The shape useTurnManager/GameBoardScreen/localGameSession actually depend on - lets online play
 * (src/online/) hand them a HostTurnManagerBridge or RemoteTurnManager instead of a real local
 * TurnManager, with zero changes to turnManager.ts itself. TurnManager already satisfies this
 * structurally (TypeScript doesn't need an explicit `implements` - its EventEmitter<T> fields
 * already have a superset of Listenable<T>'s single `.on()` method, and its `submitMove`/
 * `requestRoll`/`currentPlayer` already match exactly), so no changes to that file are needed for
 * this extraction to work.
 */
export interface TurnManagerLike {
  readonly turnStarted: Listenable<PlayerState>
  readonly diceRolled: Listenable<DiceRoll>
  readonly parkillerMoved: Listenable<ParkillerMoveResult>
  readonly moveChoicesReady: Listenable<MoveOption[]>
  readonly moveNotPossible: Listenable<void>
  readonly moveApplied: Listenable<MoveResult>
  readonly moveAnimationReady: Listenable<MoveAnimationInfo>
  readonly pieceEliminatedByDoubles: Listenable<Piece>
  readonly rewardOffered: Listenable<RewardGrant>
  readonly rewardForfeited: Listenable<RewardGrant>
  readonly gameWon: Listenable<PlayerState>
  readonly currentPlayer: PlayerState
  /** Which color *this specific client* controls, for online play - undefined/null means "no
   * restriction" (a local pass-and-play TurnManager doesn't set this at all, since one shared
   * device controls every color; see GameBoardScreen.tsx's own use of this for why online play
   * needs it: every client replays the same broadcast dice roll locally, so without this, any
   * connected client's UI would show the current turn's pieces as selectable and its own roll
   * button as enabled, even for a color that isn't theirs - the Master still rejects the resulting
   * network intent, but the *initiating* client's own UI had no way to know not to let them try). */
  readonly localPlayerColor?: PieceColor | null
  start(): void
  requestRoll(): void
  submitMove(chosenPiece: Piece): MoveResult | null
  /** Online-only (HostTurnManagerBridge/RemoteTurnManager): stops listening for further network
   * messages. Optional so a local TurnManager (nothing to dispose - no subscriptions of its own)
   * still satisfies this interface structurally with zero changes, same as every other member. */
  dispose?(): void
}
