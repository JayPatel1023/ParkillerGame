import type { BoardData } from '../board/boardData'
import { Dice, type DiceLike } from '../dice'
import type { PieceColor } from '../pieceColor'
import { snapshotPiece, type Piece, type PieceSnapshot } from '../pieces/piece'
import { applyMove, getValidMoves, resolveBarrierElimination, wouldCapture } from '../rules/parchisRules'
import type { MoveOption, MoveResult } from '../rules/moveOption'
import type { RuleSettings } from '../rules/ruleSettings'
import { hasWon, type PlayerState } from './playerState'

export interface DiceRoll {
  dieA: number
  dieB: number
  /** The Parkiller's own die (PK2) - a 3rd, black die, rolled and resolved before dieA/dieB. */
  blackDie: number
}

export interface ParkillerMoveResult {
  color: PieceColor
  before: number
  after: number
  capturedPawn: Piece | null
  capturedParkillerColor: PieceColor | null
  /** True only for the roll that actually moves this Parkiller for the first time - lets BoardScene
   * animate that one hop starting from the board's center (see Parkiller.hasMoved) instead of the
   * home-entrance track square every later hop starts from. */
  firstMove: boolean
}

/** Everything BoardScene needs to play a piece's move as a square-by-square hop instead of an
 * instant snap. Emitted directly from TurnManager.submitMove() - not built by whoever *called*
 * submitMove() - so every path that ends up mutating a piece gets this for free: a local human's
 * click, the online host's own click (via HostTurnManagerBridge), a bot's move (BotController calls
 * submitMoveForBot(), bypassing any UI layer entirely), and a remote client replaying the host's
 * broadcast (RemoteTurnManager owns its own real TurnManager and calls submitMove() on it once the
 * broadcast lands). Reported directly: bot moves in particular had no hop animation at all, since
 * the previous approach (useTurnManager's chooseMove() snapshotting before/after around its own
 * call to submitMove()) only ever ran for the one path that went through that specific function -
 * BotController and RemoteTurnManager's broadcast replay both call submitMove() directly, so their
 * moves applied instantly with no animation and no way for that UI-layer snapshot to run at all. */
export interface MoveAnimationInfo {
  piece: Piece
  before: PieceSnapshot
  after: PieceSnapshot
  capturedPiece: Piece | null
  capturedParkillerColor: PieceColor | null
}

export type RewardReason = 'capture' | 'finish'

export interface RewardGrant {
  amount: number
  reason: RewardReason
}

// PC 3 (capture) and PC 4 (finish) reward sizes, in squares. PK7 rewards a Parkiller kill at the
// same 20-square size ("10 x 2") as a regular capture, so it reuses CAPTURE_REWARD rather than
// needing its own constant.
const CAPTURE_REWARD = 20
const FINISH_REWARD = 10

function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

type Listener<T> = (value: T) => void

class EventEmitter<T> {
  private listeners: Listener<T>[] = []
  on(listener: Listener<T>) {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }
  emit(value: T) {
    for (const listener of this.listeners) listener(value)
  }
}

// Tracks which of this roll's two dice are still unspent. A die is spent either individually (one
// piece moved by its own face value) or together as the sum (one piece moved by both at once) -
// see offerMoves, which only proposes the sum while both are still available.
interface DiceState {
  dieA: number
  dieB: number
  dieAUsed: boolean
  dieBUsed: boolean
}

// Orchestrates one local (hotseat) game: whose turn it is, rolling, offering move choices, applying
// them. Rolls two white dice per the client's rulebook (not the single-die classic variant this
// milestone started with) - a piece can move by die A's value, die B's value, or their sum, so one
// roll can move up to two different pieces (one per die) or one piece by the combined total.
export class TurnManager {
  readonly turnStarted = new EventEmitter<PlayerState>()
  readonly diceRolled = new EventEmitter<DiceRoll>()
  readonly parkillerMoved = new EventEmitter<ParkillerMoveResult>()
  readonly moveChoicesReady = new EventEmitter<MoveOption[]>()
  readonly moveNotPossible = new EventEmitter<void>()
  readonly moveApplied = new EventEmitter<MoveResult>()
  readonly moveAnimationReady = new EventEmitter<MoveAnimationInfo>()
  readonly pieceEliminatedByDoubles = new EventEmitter<Piece>()
  readonly rewardOffered = new EventEmitter<RewardGrant>()
  readonly rewardForfeited = new EventEmitter<RewardGrant>()
  readonly gameWon = new EventEmitter<PlayerState>()

  private board: BoardData
  private players: PlayerState[]
  private settings: RuleSettings
  private dice: DiceLike

  private currentPlayerIndex = 0
  private consecutiveDoubles = 0
  private lastMovedPiece: Piece | null = null
  // PK5/PK10's several "eliminates whichever pawn arrived last" rules need a shared, game-wide
  // ordering across every piece's own landing, not per-piece state - see Piece.arrivedAt's own
  // comment for why this is a plain counter, not a timestamp.
  private nextArrivalSequence = 1
  private diceState: DiceState | null = null
  private pendingMoves: MoveOption[] | null = null
  // PK2/PK6a: the black die only rolls once per actual turn - skipped on the bonus turn granted by
  // a double, verified directly against the reference implementation's turn controller
  // ("if (!obj_dado.tiene_otro_turno && parkiSigueVivo(...))"). Set by endTurn() for the *next*
  // requestRoll() to read.
  private nextRollIsBonusTurn = false
  // PK6/PK8: a common piece can only eliminate the Parkiller during the roll that just produced
  // doubles - verified directly against the reference's doblete_mata_parkiller flag, which opens on
  // any double and closes again after the very first subsequent piece move (capture or not).
  private parkillerCapturableThisRoll = false

  // `dice` accepts anything roll()-shaped, not just the real Dice class - tests inject an exact
  // roll queue instead of a seed, since a seed's resulting face values aren't hand-pickable.
  constructor(board: BoardData, players: PlayerState[], settings: RuleSettings, dice: DiceLike = new Dice()) {
    this.board = board
    this.players = players
    this.settings = settings
    this.dice = dice
  }

  get currentPlayer(): PlayerState {
    return this.players[this.currentPlayerIndex]
  }

  start() {
    this.turnStarted.emit(this.currentPlayer)
  }

  requestRoll() {
    const dieA = this.dice.roll()
    const dieB = this.dice.roll()
    const blackDie = this.dice.roll()
    this.diceRolled.emit({ dieA, dieB, blackDie })

    // PK2/PK6a: the black die's *effect* is only applied once per actual turn - a bonus turn
    // granted by a double is still the same turn's continuation for this purpose, so the Parkiller
    // doesn't actually move or capture anything on it, verified directly against the reference
    // implementation's turn controller (still rolled/shown every time, for a simple, predictable
    // "always three dice per roll" contract - only its effect on the Parkiller is gated). It isn't
    // a move the player chooses, so it's applied here immediately rather than waiting on a
    // pendingMoves selection. The UI plays its hop animation off this event on its own; resolution
    // here doesn't wait on that animation actually finishing, same as every other move in this
    // engine (game state always advances synchronously - only the visual playback takes time).
    const isBonusTurn = this.nextRollIsBonusTurn
    const parkillerResult = isBonusTurn ? this.noopParkillerResult() : this.resolveParkillerMove(blackDie)
    this.parkillerMoved.emit(parkillerResult)

    // PK6/PK8: every double re-opens the window for a common piece to eliminate the Parkiller on
    // its very next move, regardless of whether the black die itself moved this roll.
    this.parkillerCapturableThisRoll = dieA === dieB

    if (dieA === dieB) {
      this.consecutiveDoubles++
      if (this.settings.thirdConsecutiveDoubleEliminatesLastMoved && this.consecutiveDoubles >= 3) {
        this.consecutiveDoubles = 0
        // Home-corridor pieces are exempt - the streak just continues instead of costing a piece.
        if (this.lastMovedPiece && this.lastMovedPiece.state !== 'InHomeCorridor') {
          this.lastMovedPiece.state = 'InYard'
          this.lastMovedPiece.trackPosition = -1
          this.lastMovedPiece.corridorPosition = -1
          this.pieceEliminatedByDoubles.emit(this.lastMovedPiece)
          this.lastMovedPiece = null
          this.endTurn(false)
          return
        }
      }
    } else {
      this.consecutiveDoubles = 0
    }

    this.diceState = { dieA, dieB, dieAUsed: false, dieBUsed: false }

    // PC 6.2: collecting a reward takes priority over any dice still unspent - if the Parkiller's
    // own move just eliminated an opposing Parkiller, its PK7 reward is offered ahead of the
    // white-dice move choices below, same as a regular capture's reward already is in submitMove().
    // offerReward()'s own fallback (continueAfterMove()) already knows how to fall through to
    // offerMoves() once the reward is spent or forfeited.
    if (parkillerResult.capturedParkillerColor) {
      this.offerReward({ amount: CAPTURE_REWARD, reason: 'capture' })
      return
    }

    this.offerMoves()
  }

  // Reported when the black die is skipped on a bonus turn (see requestRoll) - the Parkiller
  // simply didn't move, so before === after gives the animation system zero hops for free.
  private noopParkillerResult(): ParkillerMoveResult {
    const player = this.currentPlayer
    const before = player.parkiller.trackPosition
    return { color: player.color, before, after: before, capturedPawn: null, capturedParkillerColor: null, firstMove: false }
  }

  // PK2/PK3: moves the current player's Parkiller by the black die's value, opposite direction
  // (decreasing track index) from every regular piece. PK5/PK6: eliminates whichever opposing
  // pawn or Parkiller it lands on exactly, if any - a captured pawn goes back to its yard with no
  // reward to its owner (PK5); a captured opposing Parkiller earns this player PK7's reward,
  // offered by requestRoll() right after this returns. PK5/PK10: landing on an existing barrier
  // (2 pawns already sharing that square) doesn't just coexist or get blocked - it always
  // eliminates exactly one of the two, per resolveBarrierElimination's own rules.
  private resolveParkillerMove(blackDieValue: number): ParkillerMoveResult {
    const player = this.currentPlayer
    const parkiller = player.parkiller
    const before = parkiller.trackPosition

    if (parkiller.state !== 'InPlay') {
      return { color: player.color, before, after: before, capturedPawn: null, capturedParkillerColor: null, firstMove: false }
    }

    const firstMove = !parkiller.hasMoved
    parkiller.hasMoved = true
    const after = mod(before - blackDieValue, this.board.trackLength)
    parkiller.trackPosition = after

    let capturedPawn: Piece | null = null
    if (!this.board.safeTrackIndices.has(after)) {
      const piecesThere: Piece[] = []
      for (const p of this.players) {
        for (const piece of p.pieces) {
          if (piece.state === 'OnTrack' && piece.trackPosition === after) piecesThere.push(piece)
        }
      }
      const target =
        piecesThere.length >= 2
          ? resolveBarrierElimination(player.color, piecesThere)
          : (piecesThere.find((p) => p.color !== player.color) ?? null)
      if (target) {
        target.state = 'InYard'
        target.trackPosition = -1
        capturedPawn = target
      }
    }

    let capturedParkillerColor: PieceColor | null = null
    for (const opponent of this.players) {
      if (opponent.color === player.color) continue
      if (opponent.parkiller.state === 'InPlay' && opponent.parkiller.trackPosition === after) {
        opponent.parkiller.state = 'Eliminated'
        capturedParkillerColor = opponent.color
        break
      }
    }

    return { color: player.color, before, after, capturedPawn, capturedParkillerColor, firstMove }
  }

  private offerMoves() {
    const state = this.diceState
    if (!state) return

    const dieAMoves = !state.dieAUsed
      ? getValidMoves(this.board, this.currentPlayer, this.players, state.dieA, this.settings, 'dieA')
      : null
    const dieBMoves = !state.dieBUsed
      ? getValidMoves(this.board, this.currentPlayer, this.players, state.dieB, this.settings, 'dieB')
      : null

    // PC2.1: "A pawn must move to the starting square" whenever a die's own value is the exit
    // roll and a yard piece could use it - that die can only be spent on the exit, or on a move
    // that would capture something (PC3/PK8 already outrank this via the filter below, so a
    // capture must survive here too), not reassigned to a different, non-capturing piece by the
    // same amount. The *other* die stays completely free, before or after, in either order
    // (offerMoves runs fresh after every move, so whichever die the player didn't spend just gets
    // offered again next time around).
    const dieAHasExit = state.dieA === this.settings.exitRoll && (dieAMoves?.some((m) => m.kind === 'ExitYard') ?? false)
    const dieBHasExit = state.dieB === this.settings.exitRoll && (dieBMoves?.some((m) => m.kind === 'ExitYard') ?? false)
    const restrictToExitOrCapture = (moves: MoveOption[]) =>
      moves.filter((m) => m.kind === 'ExitYard' || wouldCapture(this.board, m, this.players, this.parkillerCapturableThisRoll))

    const bestPerPiece = new Map<Piece, MoveOption>()
    const addMoves = (moves: MoveOption[]) => {
      for (const move of moves) {
        if (!bestPerPiece.has(move.piece)) bestPerPiece.set(move.piece, move)
      }
    }
    if (dieAMoves) addMoves(dieAHasExit ? restrictToExitOrCapture(dieAMoves) : dieAMoves)
    if (dieBMoves) addMoves(dieBHasExit ? restrictToExitOrCapture(dieBMoves) : dieBMoves)
    // The sum can only combine both dice into one board-piece move once neither individual die is
    // still obligated to a mandatory exit - otherwise it would let a player dodge that exit by
    // spending both dice on a single already-in-play piece instead.
    if (dieAMoves && dieBMoves && !dieAHasExit && !dieBHasExit) {
      addMoves(getValidMoves(this.board, this.currentPlayer, this.players, state.dieA + state.dieB, this.settings, 'sum'))
    }

    let options = [...bestPerPiece.values()]

    // PC3/PK8: capturing is mandatory whenever it's available - a player can't sidestep an
    // available capture by choosing to move a different, non-capturing piece instead.
    const capturingOptions = options.filter((m) => wouldCapture(this.board, m, this.players, this.parkillerCapturableThisRoll))
    if (capturingOptions.length > 0) options = capturingOptions

    this.pendingMoves = options

    if (this.pendingMoves.length === 0) {
      this.moveNotPossible.emit()
      // Neither remaining die has a legal move - both are lost per the rulebook ("if the move is
      // impossible, the roll is lost"), not retried.
      state.dieAUsed = true
      state.dieBUsed = true
      this.finishDiceUsage()
      return
    }

    this.moveChoicesReady.emit(this.pendingMoves)
  }

  // Returns the applied MoveResult (or null if the piece wasn't a valid choice) so callers - namely
  // useTurnManager - can see what happened (e.g. capturedPiece) without a separate moveApplied
  // subscription racing the synchronous mutation this method already performs.
  submitMove(chosenPiece: Piece): MoveResult | null {
    const move = this.pendingMoves?.find((m) => m.piece === chosenPiece)
    if (!move) return null
    const isRewardMove = move.diceSource === 'reward'
    const before = snapshotPiece(chosenPiece)

    const result = applyMove(this.board, move, this.players, this.settings, this.parkillerCapturableThisRoll, this.nextArrivalSequence++)
    // PK6/PK8: the window to kill the Parkiller with a common piece closes after this roll's first
    // move, whether or not it was actually used for that.
    this.parkillerCapturableThisRoll = false
    this.lastMovedPiece = chosenPiece
    this.pendingMoves = null

    if (!isRewardMove && this.diceState) {
      if (move.diceSource === 'sum') {
        this.diceState.dieAUsed = true
        this.diceState.dieBUsed = true
      } else if (move.diceSource === 'dieA') {
        this.diceState.dieAUsed = true
      } else {
        this.diceState.dieBUsed = true
      }
    }

    this.moveApplied.emit(result)
    this.moveAnimationReady.emit({
      piece: chosenPiece,
      before,
      after: snapshotPiece(chosenPiece),
      capturedPiece: result.capturedPiece,
      capturedParkillerColor: result.capturedParkillerColor,
    })

    if (hasWon(this.currentPlayer)) {
      this.gameWon.emit(this.currentPlayer)
      return result
    }

    // PC 3/PC 4: capturing or finishing earns a reward, and PC 6.2 places collecting it ahead of
    // any dice still unspent. A move landing on this same reward can itself capture again, in
    // which case PC 5 adds the new reward on top rather than replacing it. PK7 rewards eliminating
    // an opposing Parkiller the same way a regular capture does.
    if (result.capturedPiece || result.capturedParkillerColor) this.offerReward({ amount: CAPTURE_REWARD, reason: 'capture' })
    if (result.pieceFinished) this.offerReward({ amount: FINISH_REWARD, reason: 'finish' })
    if (result.capturedPiece || result.capturedParkillerColor || result.pieceFinished) return result

    this.continueAfterMove()
    return result
  }

  // Offers a bonus move for an earned reward - restricted (via getValidMoves' own exitRoll check)
  // to pieces already in play, per PC 5 ("you cannot remove a pawn from the shelter... and then
  // claim it"). If nothing can use it, PC 5 forfeits it outright rather than holding it for later.
  // Deliberately not subject to mandatory capture (verified against the reference: reward moves
  // let the player pick freely which piece to advance, capture available or not).
  private offerReward(grant: RewardGrant) {
    const moves = getValidMoves(this.board, this.currentPlayer, this.players, grant.amount, this.settings, 'reward')
    if (moves.length === 0) {
      this.rewardForfeited.emit(grant)
      this.continueAfterMove()
      return
    }
    this.pendingMoves = moves
    this.rewardOffered.emit(grant)
    this.moveChoicesReady.emit(this.pendingMoves)
  }

  // Resumes whatever the roll still owes after a move (and any reward chain from it) resolves:
  // more dice to spend, or the turn is over.
  private continueAfterMove() {
    if (this.diceState && (!this.diceState.dieAUsed || !this.diceState.dieBUsed)) {
      this.offerMoves()
      return
    }
    this.finishDiceUsage()
  }

  private finishDiceUsage() {
    this.diceState = null
    const grantExtraTurn = this.consecutiveDoubles > 0
    this.endTurn(grantExtraTurn)
  }

  private endTurn(grantExtraTurn: boolean) {
    this.nextRollIsBonusTurn = grantExtraTurn
    if (!grantExtraTurn) {
      this.consecutiveDoubles = 0
      this.lastMovedPiece = null
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length
    }
    this.turnStarted.emit(this.currentPlayer)
  }
}
