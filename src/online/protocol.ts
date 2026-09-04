import type { PieceColor } from '../core/pieceColor'

/** Sent via RoomTransport.sendToMaster - a non-master (or the Master's own UI, through the same
 * funnel) asking to have an action applied. Never carries a result - only the Master computes
 * that, from its own authoritative TurnManager. */
// `amount` disambiguates when the piece has more than one pending option (reachable by both dice,
// to different squares) - omitted when it only has one, same as TurnManager.submitMove's own
// optional parameter.
export type IntentMessage = { type: 'rollIntent' } | { type: 'moveIntent'; color: PieceColor; pieceIndex: number; amount?: number }

/** Sent via RoomTransport.broadcast, only ever by whoever is currently Master - the two primitive
 * inputs that fully determine TurnManager's next state. Never the resulting Piece/MoveResult/
 * ParkillerMoveResult objects themselves - those are live object references into the Master's own
 * `players` array and have no meaning to a different client's own array (see HostTurnManagerBridge
 * for the full reasoning). Every receiving client (Master included, since ReceiverGroup.All
 * includes the sender) replays these against its own local TurnManager instead. */
export type BroadcastMessage =
  | { type: 'diceRolled'; dieA: number; dieB: number; blackDie: number }
  | { type: 'moveChosen'; color: PieceColor; pieceIndex: number; amount?: number }

/** Sent once by whoever starts the game (always the Master, from the lobby) - `colors` is the
 * turn-order-assigned color list every peer must build its own `players` array from, in this
 * exact order, so everyone's TurnManager.currentPlayerIndex refers to the same player. `seats`
 * maps each occupied seat's actor number to its color - a bot-assigned color simply has no entry.
 * Sent as its own broadcast (not just room custom properties) so every already-connected client
 * transitions from the lobby to the game at the same moment.
 *
 * Reported directly ("debe de haber una tirada inicial para ver quien empieza" - there should be
 * an initial roll to see who starts): local play already runs this pre-game roll-off
 * (startingPlayer.ts), online play never did at all - the Master's own seat, always first in
 * `colors`, silently always went first. `startingPlayerRolls` is the Master's own recorded dice
 * values from calling TurnManager.determineStartingPlayer() (2 rolls per player per round, one
 * round unless the top roll ties) - every receiving client, Master included, replays the *same*
 * determineStartingPlayer() against its own local `players` array fed exactly these values through
 * a QueueDice, reconstructing an identical StartingPlayerResult (including winnerIndex) instead of
 * trusting a network-serialized result object directly - same reasoning as BroadcastMessage's own
 * doc comment just above. */
export interface GameStartedMessage {
  type: 'gameStarted'
  colors: PieceColor[]
  seats: Record<number, PieceColor>
  startingPlayerRolls: number[]
}

export type GameMessage = IntentMessage | BroadcastMessage | GameStartedMessage

export function isIntentMessage(msg: GameMessage): msg is IntentMessage {
  return msg.type === 'rollIntent' || msg.type === 'moveIntent'
}

export function isBroadcastMessage(msg: GameMessage): msg is BroadcastMessage | GameStartedMessage {
  return msg.type === 'diceRolled' || msg.type === 'moveChosen' || msg.type === 'gameStarted'
}
