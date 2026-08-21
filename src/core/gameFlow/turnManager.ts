import type { BoardData } from '../board/boardData'
import { Dice, type DiceLike } from '../dice'
import type { PieceColor } from '../pieceColor'
import { snapshotPiece, type Piece, type PieceSnapshot } from '../pieces/piece'
import { applyMove, getValidMoves, isParkillerOnTrack, ownBarrierTrackPosition, resolveBarrierElimination, wouldCapture } from '../rules/parchisRules'
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
  /** trackPosition before/after this roll - only meaningful once beforeCorridorPosition/
   * afterCorridorPosition (below) have reached the lane's own corridorLength; while still crossing
   * the corridor, these just hold whatever trackPosition was last set to (harmless, unused by the
   * scene layer for that stretch - see getParkillerMoveHopWaypoints in piecePosition.ts). */
  before: number
  after: number
  /** Parkiller.corridorPosition before/after this roll (see that field's own doc comment) - the
   * scene layer uses these, not a separate "first move" flag, to know exactly which stretch of this
   * move (still-in-corridor, corridor-to-loop crossing, pure loop, or some mix) to animate. */
  beforeCorridorPosition: number
  afterCorridorPosition: number
  capturedPawn: Piece | null
  capturedParkillerColor: PieceColor | null
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

// PC 3/PC 4/PK7/PK8's reward size, in squares - both a capture (own or via the Parkiller) and a
// finish grant reward(s) sized in these 10-square units, never one lump sum. A capture is worth
// two of them ("10 x 2"), each offered, resolved and forfeited *independently* (see
// pendingRewardQueue/offerNextReward) - reported directly: the previous single-20 model silently
// forfeited the whole thing whenever no piece could make the full 20-square jump, even if a piece
// could've made one of the two 10s ("La recompensa es de 10x2 ...si puede mover 10 debe hacerlo,
// se pierde el otro 10 si no se puede mover"), confirmed against the rulebook's own PC4/PK8 text
// ("cada salto de 10 casillas... el premio se sumaría al ya existente"). A finish is worth one.
const REWARD_UNIT = 10

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
  // PC4/PK8's "10 x 2" reward units still owed - each drained one at a time via offerNextReward,
  // so a piece unable to make one 10-square segment only forfeits *that* segment, not the pair. A
  // capture made while collecting an earlier reward pushes more onto this queue rather than
  // replacing it (PK8: "el premio se sumaría al ya existente").
  private pendingRewardQueue: RewardReason[] = []
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
    // PK6: once eliminated, a Parkiller is never rendered again (getParkillerWaypoint returns null
    // for it - see that function's own comment), so nothing in the scene layer will ever exist to
    // call back and clear the animation this event requests. Reported directly, via a screen
    // recording: the roll button stayed permanently disabled from the very next roll after a
    // player's own Parkiller died - useTurnManager set parkillerAnimation from this event
    // unconditionally, animationsSettled never saw its matching onHopsComplete because BoardScene
    // skips mounting <ParkillerMesh> entirely for an eliminated Parkiller, and nothing else was ever
    // going to clear it. There's nothing to show either way - skip the event outright instead.
    if (this.currentPlayer.parkiller.state === 'InPlay') {
      this.parkillerMoved.emit(parkillerResult)
    }

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
      this.pendingRewardQueue.push('capture', 'capture')
      this.offerNextReward()
      return
    }

    this.offerMoves()
  }

  // Reported when the black die is skipped on a bonus turn (see requestRoll) - the Parkiller
  // simply didn't move, so before === after (both trackPosition and corridorPosition) gives the
  // animation system zero hops for free.
  private noopParkillerResult(): ParkillerMoveResult {
    const player = this.currentPlayer
    const { trackPosition, corridorPosition } = player.parkiller
    return {
      color: player.color,
      before: trackPosition,
      after: trackPosition,
      beforeCorridorPosition: corridorPosition,
      afterCorridorPosition: corridorPosition,
      capturedPawn: null,
      capturedParkillerColor: null,
    }
  }

  // PK2/PK3: moves the current player's Parkiller by the black die's value, opposite direction
  // (decreasing track index) from every regular piece - once it's fully crossed its own lane's home
  // corridor (see Parkiller.corridorPosition's own doc comment). Every roll before that just spends
  // the die crossing that corridor instead, one square at a time exactly like every other move in
  // the game - the client's own explicit instruction, after three earlier attempts (instant jump,
  // sped-up walk, smooth glide) all still moved corridorLength + dieValue total and got rejected
  // every time for not matching the die ("한발자국을 움직여야하는데 8+1=9발자국갔다" - a die of 1
  // should mean exactly one square, not 9). PK5/PK6: eliminates whichever opposing pawn or Parkiller
  // it lands on exactly, if any - a captured pawn goes back to its yard with no reward to its owner
  // (PK5); a captured opposing Parkiller earns this player PK7's reward, offered by requestRoll()
  // right after this returns. PK5/PK10: landing on an existing barrier (2 pawns already sharing that
  // square) doesn't just coexist or get blocked - it always eliminates exactly one of the two, per
  // resolveBarrierElimination's own rules. None of this applies while still crossing the corridor -
  // there's nothing on the shared track to land on or capture until it actually gets there.
  private resolveParkillerMove(blackDieValue: number): ParkillerMoveResult {
    const player = this.currentPlayer
    const parkiller = player.parkiller
    const before = parkiller.trackPosition
    const beforeCorridorPosition = parkiller.corridorPosition

    if (parkiller.state !== 'InPlay') {
      return {
        color: player.color,
        before,
        after: before,
        beforeCorridorPosition,
        afterCorridorPosition: beforeCorridorPosition,
        capturedPawn: null,
        capturedParkillerColor: null,
      }
    }

    if (beforeCorridorPosition < parkiller.corridorLength) {
      const remaining = parkiller.corridorLength - beforeCorridorPosition
      if (blackDieValue < remaining) {
        // Doesn't reach the loop yet this roll - the whole roll is spent crossing more corridor.
        parkiller.corridorPosition = beforeCorridorPosition + blackDieValue
        return {
          color: player.color,
          before,
          after: before,
          beforeCorridorPosition,
          afterCorridorPosition: parkiller.corridorPosition,
          capturedPawn: null,
          capturedParkillerColor: null,
        }
      }
      // Crosses fully onto the loop this roll, with any leftover pips spent moving along it.
      parkiller.corridorPosition = parkiller.corridorLength
      const leftover = blackDieValue - remaining
      const after = mod(before - leftover, this.board.trackLength)
      parkiller.trackPosition = after
      const { capturedPawn, capturedParkillerColor } = this.resolveParkillerCollisions(player, after)
      return {
        color: player.color,
        before,
        after,
        beforeCorridorPosition,
        afterCorridorPosition: parkiller.corridorPosition,
        capturedPawn,
        capturedParkillerColor,
      }
    }

    const after = mod(before - blackDieValue, this.board.trackLength)
    parkiller.trackPosition = after
    const { capturedPawn, capturedParkillerColor } = this.resolveParkillerCollisions(player, after)
    return {
      color: player.color,
      before,
      after,
      beforeCorridorPosition,
      afterCorridorPosition: beforeCorridorPosition,
      capturedPawn,
      capturedParkillerColor,
    }
  }

  private resolveParkillerCollisions(
    player: PlayerState,
    after: number,
  ): { capturedPawn: Piece | null; capturedParkillerColor: PieceColor | null } {
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
      if (isParkillerOnTrack(opponent.parkiller) && opponent.parkiller.trackPosition === after) {
        opponent.parkiller.state = 'Eliminated'
        capturedParkillerColor = opponent.color
        break
      }
    }

    return { capturedPawn, capturedParkillerColor }
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

    // PK9.1: a double obligates breaking an existing barrier of the player's own pawns before
    // anything else this roll (PK9's own priority order: barrier-break, then PK9.2's rewards -
    // already handled elsewhere, offered ahead of returning here at all - then PK9.3's shelter
    // removal, i.e. the plain exit-lock just above). Re-checked fresh on every offerMoves() call
    // (not just once at roll time), so once the first of the double's two identical-value dice
    // actually breaks it, the second naturally sees no barrier left and stops restricting - no
    // separate "already broken this roll" tracking needed. "(unless movement is impossible)" per
    // the rulebook's own qualifier: if nothing can break it this roll, the restriction below comes
    // back empty and the obligation is waived rather than forcing a false moveNotPossible.
    const barrierPosition = state.dieA === state.dieB ? ownBarrierTrackPosition(this.currentPlayer) : null
    const restrictToBarrierBreakOrCapture = (moves: MoveOption[]) =>
      moves.filter((m) => m.piece.trackPosition === barrierPosition || wouldCapture(this.board, m, this.players, this.parkillerCapturableThisRoll))
    const applyObligations = (moves: MoveOption[], dieHasExit: boolean): MoveOption[] => {
      if (barrierPosition !== null) {
        const barrierMoves = restrictToBarrierBreakOrCapture(moves)
        if (barrierMoves.length > 0) return barrierMoves
      }
      return dieHasExit ? restrictToExitOrCapture(moves) : moves
    }

    // Keyed by piece + amount, not piece alone - a piece reachable by *both* dice (or a die and the
    // sum) keeps every distinct option instead of silently collapsing to whichever die happened to
    // be checked first. Reported directly ("SE DEBE PODER ELEGIR CON CUAL DE LOS DOS DADOS SE MUEVE
    // EL PEON"): the player never actually got a choice here before - dieA's move for a piece always
    // won, dieB's own option for that same piece was discarded outright even when it led somewhere
    // meaningfully different. Two options with the *same* amount (e.g. a double, dieA===dieB) really
    // are the identical move regardless of which die is "blamed" for it, so those still collapse to
    // one entry - nothing to choose between there.
    const byPieceAndAmount = new Map<string, MoveOption>()
    const addMoves = (moves: MoveOption[]) => {
      for (const move of moves) {
        const key = `${move.piece.color}:${move.piece.pieceIndex}:${move.amount}`
        if (!byPieceAndAmount.has(key)) byPieceAndAmount.set(key, move)
      }
    }
    if (dieAMoves) addMoves(applyObligations(dieAMoves, dieAHasExit))
    if (dieBMoves) addMoves(applyObligations(dieBMoves, dieBHasExit))
    // The sum can only combine both dice into one board-piece move once neither individual die is
    // still obligated to a mandatory exit or barrier-break - otherwise it would let a player dodge
    // either obligation by spending both dice on a single already-in-play piece instead.
    if (dieAMoves && dieBMoves && !dieAHasExit && !dieBHasExit && barrierPosition === null) {
      addMoves(getValidMoves(this.board, this.currentPlayer, this.players, state.dieA + state.dieB, this.settings, 'sum'))
    }

    let options = [...byPieceAndAmount.values()]

    // PC3/PK8: capturing is mandatory *per piece*, not across the whole roll - verified directly
    // against the reference implementation (activarFichasMovibles()/wouldComer() in
    // Parkiller_GameMaker-main), which locks a piece out of a die that *wouldn't* capture only when
    // that same piece *could* capture with the roll's other die - never touching any other piece's
    // own options. The rulebook's own prose describes exactly this escape hatch ("if you want to
    // avoid this, you can move another pawn with the matching number and then the pawn in
    // question"): a piece that could capture can't dodge into a non-capturing move for itself, but a
    // *different* piece stays completely free to use either die normally, including the very die
    // that would have captured. Reported directly as broken the previous way: capturing anywhere in
    // the roll forced every other piece into a capturing move too, with no way to redirect a die
    // elsewhere the way the rulebook explicitly allows.
    const optionsByPiece = new Map<Piece, MoveOption[]>()
    for (const move of options) {
      const list = optionsByPiece.get(move.piece)
      if (list) list.push(move)
      else optionsByPiece.set(move.piece, [move])
    }
    options = [...optionsByPiece.values()].flatMap((pieceOptions) => {
      const capturing = pieceOptions.filter((m) => wouldCapture(this.board, m, this.players, this.parkillerCapturableThisRoll))
      return capturing.length > 0 ? capturing : pieceOptions
    })

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
  // subscription racing the synchronous mutation this method already performs. `amount` disambiguates
  // when a piece has more than one pending option (e.g. reachable by both dieA and dieB, to
  // different squares) - omit it when the piece only has one, same as every existing caller already
  // does; passed but matching nothing (a stale/adversarial value) falls through to null, same as an
  // unrecognized piece already does.
  submitMove(chosenPiece: Piece, amount?: number): MoveResult | null {
    const move = this.pendingMoves?.find((m) => m.piece === chosenPiece && (amount === undefined || m.amount === amount))
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
    if (result.capturedPiece || result.capturedParkillerColor) this.pendingRewardQueue.push('capture', 'capture')
    if (result.pieceFinished) this.pendingRewardQueue.push('finish')

    this.offerNextReward()
    return result
  }

  // Drains pendingRewardQueue one 10-square unit at a time - each unit gets its own independent
  // offerReward call (own mandatory-if-possible check, own forfeit if not), rather than resolving
  // the whole queue as one lump sum. Falls through to continueAfterMove once nothing's left owed,
  // whether that's because the queue started empty (an ordinary move) or just ran dry.
  private offerNextReward() {
    const reason = this.pendingRewardQueue.shift()
    if (!reason) {
      this.continueAfterMove()
      return
    }
    this.offerReward({ amount: REWARD_UNIT, reason })
  }

  // Offers a bonus move for one earned reward unit - restricted (via getValidMoves' own exitRoll
  // check) to pieces already in play, per PC 5 ("you cannot remove a pawn from the shelter... and
  // then claim it"). If nothing can use it, PC 5 forfeits just this unit rather than holding it for
  // later, then moves on to whatever else is still queued. Deliberately not subject to mandatory
  // capture (verified against the reference: reward moves let the player pick freely which piece to
  // advance, capture available or not).
  private offerReward(grant: RewardGrant) {
    const moves = getValidMoves(this.board, this.currentPlayer, this.players, grant.amount, this.settings, 'reward')
    if (moves.length === 0) {
      this.rewardForfeited.emit(grant)
      this.offerNextReward()
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
