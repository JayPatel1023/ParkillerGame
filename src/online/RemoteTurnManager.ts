import type { PlayerState } from '../core/gameFlow/playerState'
import { TurnManager } from '../core/gameFlow/turnManager'
import type { TurnManagerLike } from '../core/gameFlow/turnManagerLike'
import type { Piece } from '../core/pieces/piece'
import type { MoveResult } from '../core/rules/moveOption'
import type { QueueDice } from './dice'
import { findPiece } from './findPiece'
import type { GameMessage } from './protocol'
import type { RoomTransport } from './roomTransport'

/**
 * Runs on every non-master client. Owns its own real, unmodified TurnManager (constructed with a
 * QueueDice instead of a real random source) and replays whatever the Master broadcasts against
 * it, rather than computing anything itself - see HostTurnManagerBridge's own comment for why
 * results are never sent directly.
 *
 * requestRoll()/submitMove() only ever send an intent and return without touching local state -
 * the actual local game state only changes once the Master's corresponding broadcast arrives and
 * is replayed here (this.inner.submitMove(piece) below), which is what actually fires
 * moveAnimationReady - so a remote player's own move animates once the broadcast lands, same as
 * everyone else's, even though nothing here builds that animation request directly.
 */
export class RemoteTurnManager implements TurnManagerLike {
  readonly turnStarted: TurnManager['turnStarted']
  readonly diceRolled: TurnManager['diceRolled']
  readonly parkillerMoved: TurnManager['parkillerMoved']
  readonly moveChoicesReady: TurnManager['moveChoicesReady']
  readonly moveNotPossible: TurnManager['moveNotPossible']
  readonly moveApplied: TurnManager['moveApplied']
  readonly moveAnimationReady: TurnManager['moveAnimationReady']
  readonly pieceEliminatedByDoubles: TurnManager['pieceEliminatedByDoubles']
  readonly rewardOffered: TurnManager['rewardOffered']
  readonly rewardForfeited: TurnManager['rewardForfeited']
  readonly gameWon: TurnManager['gameWon']

  private readonly inner: TurnManager
  private readonly diceQueue: QueueDice
  private readonly players: PlayerState[]
  private readonly transport: RoomTransport
  private readonly unsubscribeMessage: () => void

  constructor(inner: TurnManager, diceQueue: QueueDice, players: PlayerState[], transport: RoomTransport) {
    this.inner = inner
    this.diceQueue = diceQueue
    this.players = players
    this.transport = transport

    this.turnStarted = inner.turnStarted
    this.diceRolled = inner.diceRolled
    this.parkillerMoved = inner.parkillerMoved
    this.moveChoicesReady = inner.moveChoicesReady
    this.moveNotPossible = inner.moveNotPossible
    this.moveApplied = inner.moveApplied
    this.moveAnimationReady = inner.moveAnimationReady
    this.pieceEliminatedByDoubles = inner.pieceEliminatedByDoubles
    this.rewardOffered = inner.rewardOffered
    this.rewardForfeited = inner.rewardForfeited
    this.gameWon = inner.gameWon

    this.unsubscribeMessage = transport.onMessage((data) => this.handleBroadcast(data))
  }

  get currentPlayer(): PlayerState {
    return this.inner.currentPlayer
  }

  start(): void {
    this.inner.start()
  }

  requestRoll(): void {
    this.transport.sendToMaster({ type: 'rollIntent' })
  }

  submitMove(chosenPiece: Piece): MoveResult | null {
    this.transport.sendToMaster({ type: 'moveIntent', color: chosenPiece.color, pieceIndex: chosenPiece.pieceIndex })
    return null
  }

  dispose(): void {
    this.unsubscribeMessage()
  }

  private handleBroadcast(data: unknown): void {
    const msg = data as GameMessage
    if (msg.type === 'diceRolled') {
      this.diceQueue.push(msg.dieA, msg.dieB, msg.blackDie)
      this.inner.requestRoll()
    } else if (msg.type === 'moveChosen') {
      const piece = findPiece(this.players, msg.color, msg.pieceIndex)
      if (piece) this.inner.submitMove(piece)
    }
  }
}
