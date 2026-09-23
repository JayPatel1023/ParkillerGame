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
//
// This is a *floor*, not the whole story - reported again, separately, with video: a pawn that
// had just moved visibly reverted to its starting square for a couple of seconds while the next
// roll was already in progress, then caught up. Root cause: this constant alone paced every
// moveChosen broadcast, regardless of how far that move actually walked - a move of 5+ squares
// takes amount*HOP_DURATION_MS (below) to animate, which already exceeds this flat 2000ms, so the
// *next* queued broadcast (another move, or the next roll) got applied to this.inner - and
// re-armed the board's shared diceSettledAt gate (see botController.ts's own matching comment on
// the same gate, on the bot-pacing side of this exact bug) - while the previous move's own hop was
// still genuinely playing on screen. HOP_DURATION_MS/CAPTURE_RETURN_HOPS below are duplicated from
// PieceMesh.tsx/piecePosition.ts (same reasoning as botController.ts's own matching constants -
// this file can't import the scene layer) and must be kept in sync with them.
//
// This constant itself is scoped to *within-roll* replay pacing (a double's second die, a reward
// chain) - the gap specifically when a turn hands off to a *different* player is a separate knob,
// TURN_CHANGE_HOLD_MS, applied by useTurnManager.ts's own turnStarted handler regardless of which
// TurnManagerLike implementation feeds it (this one included) - no separate handling needed here
// for that case. An earlier attempt bumped this constant itself to 20000 in response to a request
// for that turn-handoff gap, conflating the two; corrected directly ("주사위가 돌아가는시간을 길게
// 해달라는의미는전혀없다" - never meant to lengthen the dice/move-reveal timing itself) back to its
// original floor.
const REMOTE_MOVE_PACING_MS = 2000
// Kept in sync with ParkillerMesh.tsx's own PARKI_REVEAL_HOLD_MS (that constant's own doc
// comment) - the Parkiller's own hop no longer starts the instant the dice reveal finishes, it now
// waits this much longer first. Reported directly ("주사위결과가... 결과가 떨어지자마자 급하게
// 벌써움직이는 현상이잇다" - it already starts moving hastily the instant the result drops): without
// this, a diceRolled broadcast carrying a large black-die value could have its own Parkiller hop
// still genuinely playing on this client's screen well after this file's own pacing considered it
// safe to apply the *next* queued broadcast - the same "reverts, then catches up" symptom class
// botController.ts's own matching busyUntilMs tracking exists to prevent, just on the replay side.
const PARKI_REVEAL_HOLD_MS = 2000
const HOP_DURATION_MS = 480
const CAPTURE_RETURN_HOPS = 3

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
  // there's no previous action in this run for a delay to be "between") and whatever
  // applyMessage's own return value says for every one after it - REMOTE_MOVE_PACING_MS's own
  // floor for a plain roll, or the real hop time (plus any self-elimination bounce) for a move
  // that needed longer than that floor to actually finish playing.
  private drainQueue(waitMs: number): void {
    this.draining = true
    this.drainTimeout = setTimeout(() => {
      this.drainTimeout = null
      const msg = this.pendingMessages.shift()
      if (!msg) {
        this.draining = false
        return
      }
      const nextWaitMs = this.applyMessage(msg)
      this.drainQueue(nextWaitMs)
    }, waitMs)
  }

  // Returns how long to wait before the *next* queued message may be applied - see
  // REMOTE_MOVE_PACING_MS's own doc comment for why a flat constant alone isn't enough for a
  // moveChosen broadcast.
  private applyMessage(msg: GameMessage): number {
    if (msg.type === 'diceRolled') {
      this.diceQueue.push(msg.dieA, msg.dieB, msg.blackDie)
      this.inner.requestRoll()
      // See PARKI_REVEAL_HOLD_MS's own doc comment - the Parkiller's own hop (when it has one this
      // roll) doesn't start until diceSettledAt plus this hold, and then takes its own real hop time
      // on top of that - matches botController.ts's own equivalent budget for the same roll.
      return REMOTE_MOVE_PACING_MS + PARKI_REVEAL_HOLD_MS + msg.blackDie * HOP_DURATION_MS
    }
    if (msg.type === 'moveChosen') {
      const piece = findPiece(this.players, msg.color, msg.pieceIndex)
      if (!piece) return REMOTE_MOVE_PACING_MS
      const result = this.inner.submitMove(piece, msg.amount)
      if (!result) return REMOTE_MOVE_PACING_MS
      // Covers both self-elimination (PK5) and an ordinary capture - matching botController.ts's
      // own extraBounceMs for its equivalent human-move listener (see its own doc comment for the
      // exact history). This used to check eliminatedByParkiller only, on the reasoning that a
      // captured pawn's own bounce-home is a *separate* piece's own animation, not this move's own
      // hop, so it wouldn't extend how long *this* move needs before the next broadcast is safe to
      // apply - but BoardScene.tsx feeds that captured piece's own captureFlight bounce the very
      // same shared diceSettledAt gate this move's own hop uses (see PieceMesh.tsx's own hopFrom
      // hold), so under-budgeting it here let the *next* broadcast re-arm that gate while the
      // victim's own bounce was still genuinely playing - same "reverts to its start square, then
      // catches up" symptom class, just for an ordinary capture instead of a self-elimination.
      const extraBounceMs = (result.eliminatedByParkiller || result.capturedPiece) ? CAPTURE_RETURN_HOPS * HOP_DURATION_MS : 0
      return Math.max(REMOTE_MOVE_PACING_MS, result.amount * HOP_DURATION_MS + extraBounceMs)
    }
    return REMOTE_MOVE_PACING_MS
  }
}
