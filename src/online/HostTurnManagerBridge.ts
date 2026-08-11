import type { PlayerState } from '../core/gameFlow/playerState'
import { TurnManager } from '../core/gameFlow/turnManager'
import type { TurnManagerLike } from '../core/gameFlow/turnManagerLike'
import type { PieceColor } from '../core/pieceColor'
import type { Piece } from '../core/pieces/piece'
import type { MoveResult } from '../core/rules/moveOption'
import { RecordingDice } from './dice'
import { findPiece } from './findPiece'
import type { GameMessage } from './protocol'
import type { RoomTransport } from './roomTransport'

/**
 * Runs on whoever is the room's Master Client - the one authoritative copy of the game. Wraps a
 * real, unmodified TurnManager (constructed with a RecordingDice so its actual roll values can be
 * captured) and implements TurnManagerLike itself, so the Master's own GameBoardScreen binds to
 * *this*, not directly to the inner TurnManager - that's what guarantees the Master's own clicks
 * go through the same validate-then-broadcast funnel as everyone else's network intents, instead
 * of a separate code path that could accidentally skip the broadcast.
 *
 * Why broadcast only the *inputs* (dice values / chosen piece identity) and never the resulting
 * MoveResult/ParkillerMoveResult objects: BoardScene identifies pieces by object reference
 * (`moveAnimation?.piece === piece`), not by color/index. A JSON-round-tripped Piece from the
 * network would be a different object with no relation to a receiving client's own `players`
 * array - those `===` checks would silently never match. Broadcasting only the inputs lets every
 * receiving client's own real TurnManager recompute the identical result against its own local
 * array instead, sidestepping the identity problem entirely.
 */
export class HostTurnManagerBridge implements TurnManagerLike {
  readonly turnStarted: TurnManager['turnStarted']
  readonly diceRolled: TurnManager['diceRolled']
  readonly parkillerMoved: TurnManager['parkillerMoved']
  readonly moveChoicesReady: TurnManager['moveChoicesReady']
  readonly moveNotPossible: TurnManager['moveNotPossible']
  readonly moveApplied: TurnManager['moveApplied']
  readonly pieceEliminatedByDoubles: TurnManager['pieceEliminatedByDoubles']
  readonly rewardOffered: TurnManager['rewardOffered']
  readonly rewardForfeited: TurnManager['rewardForfeited']
  readonly gameWon: TurnManager['gameWon']

  private readonly inner: TurnManager
  private readonly dice: RecordingDice
  private readonly players: PlayerState[]
  private readonly transport: RoomTransport
  /** Which color each room seat (actor number) controls - fixed once the game starts (see
   * OnlineLobbyScreen for how seats are assigned before that). Bot-controlled colors have no
   * entry here at all; BotController drives those directly via requestRoll()/submitMove() on this
   * same bridge, same as the Master's own human input. */
  private readonly actorColors: Map<number, PieceColor>
  private readonly unsubscribeMessage: () => void

  constructor(inner: TurnManager, dice: RecordingDice, players: PlayerState[], transport: RoomTransport, actorColors: Map<number, PieceColor>) {
    this.inner = inner
    this.dice = dice
    this.players = players
    this.transport = transport
    this.actorColors = actorColors

    this.turnStarted = inner.turnStarted
    this.diceRolled = inner.diceRolled
    this.parkillerMoved = inner.parkillerMoved
    this.moveChoicesReady = inner.moveChoicesReady
    this.moveNotPossible = inner.moveNotPossible
    this.moveApplied = inner.moveApplied
    this.pieceEliminatedByDoubles = inner.pieceEliminatedByDoubles
    this.rewardOffered = inner.rewardOffered
    this.rewardForfeited = inner.rewardForfeited
    this.gameWon = inner.gameWon

    this.unsubscribeMessage = transport.onMessage((data, senderActorNr) => this.handleIncoming(data, senderActorNr))
  }

  get currentPlayer(): PlayerState {
    return this.inner.currentPlayer
  }

  start(): void {
    this.inner.start()
  }

  /** The Master's own UI calls this directly (no network round-trip to itself needed) - routed
   * through the same handleRollIntent() a remote player's message would use, so validation and
   * broadcasting behave identically regardless of who asked. */
  requestRoll(): void {
    this.handleRollIntent(this.transport.localActorNr)
  }

  submitMove(chosenPiece: Piece): MoveResult | null {
    return this.handleMoveIntent(this.transport.localActorNr, chosenPiece.color, chosenPiece.pieceIndex)
  }

  dispose(): void {
    this.unsubscribeMessage()
  }

  private handleIncoming(data: unknown, senderActorNr: number): void {
    const msg = data as GameMessage
    if (msg.type === 'rollIntent') this.handleRollIntent(senderActorNr)
    else if (msg.type === 'moveIntent') this.handleMoveIntent(senderActorNr, msg.color, msg.pieceIndex)
  }

  // Cheap insurance against a stale/buggy client's message corrupting shared state (a late
  // double-click, a message arriving after the turn already advanced) - not meant as anti-cheat
  // for a casual game, just correctness under normal network conditions.
  private isValidActor(actorNr: number, color: PieceColor): boolean {
    return this.actorColors.get(actorNr) === color && this.inner.currentPlayer.color === color
  }

  private handleRollIntent(actorNr: number): void {
    const seatColor = this.actorColors.get(actorNr)
    if (!seatColor || seatColor !== this.inner.currentPlayer.color) return
    this.inner.requestRoll()
    const [dieA, dieB, blackDie] = this.dice.drain()
    this.transport.broadcast({ type: 'diceRolled', dieA, dieB, blackDie })
  }

  private handleMoveIntent(actorNr: number, color: PieceColor, pieceIndex: number): MoveResult | null {
    if (!this.isValidActor(actorNr, color)) return null
    const piece = findPiece(this.players, color, pieceIndex)
    if (!piece) return null
    const result = this.inner.submitMove(piece)
    if (result) this.transport.broadcast({ type: 'moveChosen', color, pieceIndex })
    return result
  }
}
