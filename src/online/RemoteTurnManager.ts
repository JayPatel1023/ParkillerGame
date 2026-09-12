import type { PlayerState } from '../core/gameFlow/playerState'
import { TurnManager } from '../core/gameFlow/turnManager'
import type { TurnManagerLike } from '../core/gameFlow/turnManagerLike'
import type { PieceColor } from '../core/pieceColor'
import type { Piece } from '../core/pieces/piece'
import type { MoveResult } from '../core/rules/moveOption'
import type { QueueDice } from './dice'
import { findPiece } from './findPiece'
import type { GameMessage } from './protocol'
import type { RoomTransport } from './roomTransport'

// Reported directly ("Tienes que dejar una latencia de dos segundos entre movimientos. No es
// fácil seguir el juego si va tan rápido" - you have to leave a 2-second latency between moves,
// it's not easy to follow the game if it goes so fast): matches useTurnManager.ts's own
// DICE_SPIN_MS, which already paces "roll -> first action" the same way for every roll regardless
// of source - this is the other half, for however many *moveChosen* broadcasts land within that
// same roll (a double's second die, a reward chain, ...). Applied here, not left to
// handleBroadcast's own arrival timing, specifically because a broadcast's *arrival* time reflects
// nothing but real network latency, not how long the previous move's own hop is still visually
// playing - a fast remote player (or a same-device Master relaying its own quick clicks) can
// legitimately submit two moves a fraction of a second apart, and this client would otherwise
// replay both almost simultaneously with nothing but each hop's own short animation time between
// them.
const REMOTE_MOVE_PACING_MS = 2000

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
  /** See TurnManagerLike's own doc comment - which color this specific client controls, so its
   * own UI can gate the roll button/piece selection instead of only finding out its intent was
   * silently rejected by the Master after the fact. */
  readonly localPlayerColor: PieceColor | null
  // See REMOTE_MOVE_PACING_MS's own doc comment. A real FIFO queue, not independent per-message
  // timers - broadcasts have to stay strictly in the order they were sent (a dice roll can't be
  // applied to this.inner before an earlier turn's own still-queued moves are, or its internal
  // dice/turn state would desync from what actually happened) - only one drain loop is ever
  // running at a time, each iteration waiting out the pacing before applying the next message and
  // scheduling the one after it.
  private readonly pendingMessages: GameMessage[] = []
  private draining = false
  private drainTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(
    inner: TurnManager,
    diceQueue: QueueDice,
    players: PlayerState[],
    transport: RoomTransport,
    localPlayerColor: PieceColor | null = null,
  ) {
    this.inner = inner
    this.diceQueue = diceQueue
    this.players = players
    this.transport = transport
    this.localPlayerColor = localPlayerColor

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

  submitMove(chosenPiece: Piece, amount?: number): MoveResult | null {
    this.transport.sendToMaster({ type: 'moveIntent', color: chosenPiece.color, pieceIndex: chosenPiece.pieceIndex, amount })
    return null
  }

  dispose(): void {
    this.unsubscribeMessage()
    if (this.drainTimeout) clearTimeout(this.drainTimeout)
  }

  private handleBroadcast(data: unknown): void {
    this.pendingMessages.push(data as GameMessage)
    if (!this.draining) this.drainQueue(0)
  }

  // `waitMs` is 0 for the very first message of a fresh drain (nothing to pace against yet -
  // there's no previous action in this run for a delay to be "between") and
  // REMOTE_MOVE_PACING_MS for every one after it.
  private drainQueue(waitMs: number): void {
    this.draining = true
    this.drainTimeout = setTimeout(() => {
      this.drainTimeout = null
      const msg = this.pendingMessages.shift()
      if (!msg) {
        this.draining = false
        return
      }
      this.applyMessage(msg)
      this.drainQueue(REMOTE_MOVE_PACING_MS)
    }, waitMs)
  }

  private applyMessage(msg: GameMessage): void {
    if (msg.type === 'diceRolled') {
      this.diceQueue.push(msg.dieA, msg.dieB, msg.blackDie)
      this.inner.requestRoll()
    } else if (msg.type === 'moveChosen') {
      const piece = findPiece(this.players, msg.color, msg.pieceIndex)
      if (piece) this.inner.submitMove(piece, msg.amount)
    }
  }
}
