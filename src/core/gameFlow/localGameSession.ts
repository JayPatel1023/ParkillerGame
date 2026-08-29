import type { BoardData } from '../board/boardData'
import type { BoardDefinition } from '../board/boardDefinition'
import { toBoardData } from '../board/boardDefinition'
import type { DiceLike } from '../dice'
import type { PieceColor } from '../pieceColor'
import { defaultRuleSettings } from '../rules/ruleSettings'
import type { MoveResult } from '../rules/moveOption'
import type { Piece } from '../pieces/piece'
import { BotController, type BotDrivableSession } from './botController'
import { createPlayerState, type PlayerState } from './playerState'
import type { StartingPlayerResult } from './startingPlayer'
import { TurnManager } from './turnManager'
import type { Listenable, TurnManagerLike } from './turnManagerLike'

/** Wraps a plain local TurnManager so it can also drive bot-controlled colors - see
 * localGameSession's own beginLocalGame() for when this is used vs. a bare TurnManager. Forwards
 * every TurnManagerLike member straight to `inner` unchanged; the two things it actually adds are
 * `localPlayerColor` (fixed to whichever color the human picked, gating GameBoardScreen's own UI
 * the exact same way it already gates online play - see TurnManagerLike's own doc comment on that
 * field) and rollForBot()/submitMoveForBot() (BotDrivableSession's own two methods - for local
 * play these are just requestRoll()/submitMove() under those names, since there's no "connected
 * actor" concept to bypass at all on one shared device, unlike HostTurnManagerBridge's own version
 * of these same two methods). */
class LocalVsBotsSession implements TurnManagerLike, BotDrivableSession {
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

  constructor(
    private readonly inner: TurnManager,
    readonly localPlayerColor: PieceColor,
  ) {
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
  }

  get currentPlayer(): PlayerState {
    return this.inner.currentPlayer
  }

  // Forwarded straight from `inner` - BotDrivableSession (botController.ts) needs read access to
  // the board and every player's own state for its own wouldWalkIntoUnprotectedParki check, same
  // reasoning as HostTurnManagerBridge's own board/players forwarding.
  get board(): BoardData {
    return this.inner.board
  }

  get players(): readonly PlayerState[] {
    return this.inner.players
  }

  start(): void {
    this.inner.start()
  }

  requestRoll(): void {
    this.inner.requestRoll()
  }

  submitMove(chosenPiece: Piece, amount?: number): MoveResult | null {
    return this.inner.submitMove(chosenPiece, amount)
  }

  rollForBot(): void {
    this.inner.requestRoll()
  }

  submitMoveForBot(piece: Piece, amount?: number): MoveResult | null {
    return this.inner.submitMove(piece, amount)
  }
}

export interface LocalGameSession {
  turnManager: TurnManagerLike
  players: PlayerState[]
  /** Only set in vs-bots mode (see beginLocalGame's own humanColor param) - GameBoardScreen/App.tsx
   * must call this on cleanup (unmount, or starting a fresh game) to stop the bots' own pending
   * timeouts, same as OnlineLobbyScreen already does for its own BotController. undefined in plain
   * hotseat mode, where there's nothing to dispose. */
  dispose?: () => void
  /** Only set in vs-bots mode - forwards BotController's own pieceHighlighted straight through
   * (see that field's own doc comment) so GameBoardScreen can run the same selectable-piece
   * indicator for a bot's just-decided move that a human's own choosable piece already gets. */
  botPieceHighlighted?: Listenable<Piece | null>
  /** Requested directly ("cada jugador y los bots lanzan los dados blancos para indicar quien
   * comienza la partida"): every local game's own pre-game roll-off (see startingPlayer.ts),
   * always run before the first real turn - GameBoardScreen shows this once on mount, then never
   * again for this session (the game itself has already started by the time it's shown; nothing
   * about game state depends on the player actually seeing it). */
  startingPlayerResult: StartingPlayerResult
}

// Entry point for milestone 1: same-device play, 2-6 real players, no networking. Two modes:
// - Classic hotseat (humanColor omitted): every color is a real player passing the device around,
//   exactly as before.
// - vs-bots (humanColor provided): reported directly ("EL JUGADOR AL INICIO DEBE PODER ELEGIR EL
//   COLOR Y JUGAR CONTRA LOS OTROS OPONENTE PILOTADOS POR EL BOT" - the player should be able to
//   choose their color at the start and play against bot-piloted opponents) - the human plays only
//   their own chosen color; every other color in `participatingColors` is bot-driven, using the
//   same BotController this project's online play already relies on (see botController.ts's own
//   doc comment for why that class lives in core/gameFlow, not online/, so this doesn't have to
//   depend on a higher layer for it).
export function beginLocalGame(
  boardDefinition: BoardDefinition,
  participatingColors: PieceColor[],
  humanColor?: PieceColor,
  // Test-only: a real game always wants genuine random dice (the default, a real Dice()), but a
  // test asserting on *specific* bot behavior can't reliably wait out real randomness - confirmed
  // directly, a real-dice version of this function's own vs-bots test flaked depending on unrelated
  // timing (how many Math.random() calls an earlier test in the same file happened to consume
  // first, shifting this run's own sequence). Same DiceLike-injection pattern TurnManager itself
  // already exposes for exactly this reason.
  dice?: DiceLike,
): LocalGameSession {
  const board = toBoardData(boardDefinition)
  const players = participatingColors.map((color) => createPlayerState(color, board))
  const turnManager = new TurnManager(board, players, defaultRuleSettings(), dice)
  const startingPlayerResult = turnManager.determineStartingPlayer()

  if (humanColor === undefined) {
    turnManager.start()
    return { turnManager, players, startingPlayerResult }
  }

  const session = new LocalVsBotsSession(turnManager, humanColor)
  const botColors = new Set(participatingColors.filter((color) => color !== humanColor))
  const botController = botColors.size > 0 ? new BotController(session, botColors) : null
  turnManager.start()
  return {
    startingPlayerResult,
    turnManager: session,
    players,
    dispose: () => botController?.dispose(),
    botPieceHighlighted: botController?.pieceHighlighted,
  }
}
