import type { PieceColor } from '../core/pieceColor'

/** Sent via RoomTransport.sendToMaster - a non-master (or the Master's own UI, through the same
 * funnel) asking to have an action applied. Never carries a result - only the Master computes
 * that, from its own authoritative TurnManager. */
export type IntentMessage = { type: 'rollIntent' } | { type: 'moveIntent'; color: PieceColor; pieceIndex: number }

/** Sent via RoomTransport.broadcast, only ever by whoever is currently Master - the two primitive
 * inputs that fully determine TurnManager's next state. Never the resulting Piece/MoveResult/
 * ParkillerMoveResult objects themselves - those are live object references into the Master's own
 * `players` array and have no meaning to a different client's own array (see HostTurnManagerBridge
 * for the full reasoning). Every receiving client (Master included, since ReceiverGroup.All
 * includes the sender) replays these against its own local TurnManager instead. */
export type BroadcastMessage =
  | { type: 'diceRolled'; dieA: number; dieB: number; blackDie: number }
  | { type: 'moveChosen'; color: PieceColor; pieceIndex: number }

export type GameMessage = IntentMessage | BroadcastMessage

export function isIntentMessage(msg: GameMessage): msg is IntentMessage {
  return msg.type === 'rollIntent' || msg.type === 'moveIntent'
}

export function isBroadcastMessage(msg: GameMessage): msg is BroadcastMessage {
  return msg.type === 'diceRolled' || msg.type === 'moveChosen'
}
