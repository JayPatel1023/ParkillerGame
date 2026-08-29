import type { BoardData } from '../board/boardData'
import { Dice, type DiceLike } from '../dice'
import type { PieceColor } from '../pieceColor'
import { snapshotPiece, type Piece, type PieceSnapshot } from '../pieces/piece'
import {
  applyMove,
  getValidMoves,
  isParkillerOnTrack,
  ownBarrierTrackPosition,
  ownCorridorBarrierPosition,
  resolveBarrierElimination,
  wouldCapture,
} from '../rules/parchisRules'
import type { MoveOption, MoveResult } from '../rules/moveOption'
import type { RuleSettings } from '../rules/ruleSettings'
import { hasWon, type PlayerState } from './playerState'

export interface DiceRoll {
  dieA: number
  dieB: number
  /** The Parkiller's own die (PK2) - a 3rd, black die, rolled and resolved before dieA/dieB. */
  blackDie: number
}

/** A barrier obligation's location - the shared track or the player's own home corridor (PC2.4:
 * "including those in the finish zone"). `position` is a trackPosition for 'track', a
 * corridorPosition for 'corridor' - the two are separate numeric spaces. */
type BarrierLocation = { kind: 'track'; position: number } | { kind: 'corridor'; position: number }

/** Why moveNotPossible fired - reported directly (Carlos: "Cuando hay una barrera no se quieren
 * mover ninguno de los dos peones... no ha manera"): a barrier-forfeited roll used to look
 * identical to a roll that genuinely had nothing to move, and the turn just silently passed either
 * way with zero on-screen explanation. 'barrier' means offerMoves() actually found candidate moves
 * this roll but excludeLockedBarrierPieces filtered every one of them out for sitting in the
 * player's own barrier - 'none' covers every other reason (nothing in play could use either die at
 * all). GameBoardScreen uses this to show a specific "barrier locked, need a double" message
 * instead of the turn just silently advancing. */
export type MoveNotPossibleReason = 'barrier' | 'none'

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
  /** PK5: set when this move landed on an unprotected opposing Parkiller - see MoveResult's own
   * matching doc comment for why `after` alone (already back to InYard) can't drive the animation
   * on its own. The scene layer walks the piece here first, in order, before sending it home. */
  eliminatedByParkillerAt?: number
  eliminatedByParkillerColor?: PieceColor
}

export type RewardReason = 'capture' | 'finish'

// The amount actually being offered *this* time - RewardToast/RewardBurst (and every other
// external listener) only ever need to know what's on the table right now, not the internal
// bookkeeping of whether it's the first half of a capture's own 20, a re-offered remainder, or a
// finish's own flat 10.
export interface RewardGrant {
  amount: number
  reason: RewardReason
}

// PENDING_REWARD's own internal bookkeeping, on top of RewardGrant: excludePiece is set only when
// re-offering a capture's *remainder* after the player already split off part of it onto one piece
// - "another pawn" (the client's own rulebook wording) means that same piece can't also take the
// rest, so it's excluded from this specific re-offer rather than tracked as a broader "already
// used this reward" flag that would outlive this one grant.
interface PendingReward extends RewardGrant {
  excludePiece?: Piece
}

// PC 3/PC 4/PK7/PK8's reward size, in squares - a capture (own or via the Parkiller) is worth 20,
// a finish worth 10 (a flat, non-splittable single unit either way).
//
// A capture's own 20 is a genuine *choice*, not a forced split - confirmed directly in the
// client's own corrected rulebook (rules.pdf, "Bonus" pages, present on every one of Pawn
// Capture/Parki Elimination/Bonuses): "Choose one: Move one Pawn 20 spaces. OR Move one Pawn 10
// spaces and another pawn 10 spaces." This was previously always forced down the second path
// (two independent, forced 10s) on the strength of an earlier, more literal client quote ("La
// recompensa es de 10x2 ...si puede mover 10 debe hacerlo, se pierde el otro 10 si no se puede
// mover") - the two aren't actually in conflict once read as "choice, with the always-split path
// being *one* valid way to use it": offerReward now offers *both* a 20-in-one-piece move and a
// 10-in-one-piece move together (same amount-keyed pattern offerMoves already uses for dieA/
// dieB/sum), and only re-offers the remaining 10 - excluding whichever piece just moved - if the
// player picks the smaller amount first. Picking the 20 outright resolves the whole reward in one
// move, matching the rulebook's own first option exactly.
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
  readonly moveNotPossible = new EventEmitter<MoveNotPossibleReason>()
  readonly moveApplied = new EventEmitter<MoveResult>()
  readonly moveAnimationReady = new EventEmitter<MoveAnimationInfo>()
  readonly pieceEliminatedByDoubles = new EventEmitter<Piece>()
  readonly rewardOffered = new EventEmitter<RewardGrant>()
  readonly rewardForfeited = new EventEmitter<RewardGrant>()
  readonly gameWon = new EventEmitter<PlayerState>()

  // Both readonly-public, not private - BotController (see its own wouldWalkIntoUnprotectedParki)
  // needs read access to the board and every player's own state, not just this.currentPlayer, to
  // judge whether a candidate move is safe before picking it. Still never reassigned after the
  // constructor, same as when these were private - only the *visibility* changed.
  readonly board: BoardData
  readonly players: PlayerState[]
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
  // A capture/Parkiller-elimination reward is worth 20, offered as a genuine *choice* (confirmed
  // directly in the client's own corrected rulebook, "Bonus" pages: "Choose one: Move one Pawn 20
  // spaces. OR Move one Pawn 10 spaces and another pawn 10 spaces.") rather than always forced into
  // two separate fixed 10s - see offerReward's own comment for exactly how that choice is offered.
  // A finish is worth a single, non-splittable 10 either way. Queued (not resolved immediately) so
  // a capture made while already collecting an earlier reward stacks on top instead of replacing it
  // (PK8: "el premio se sumaría al ya existente") - each entry still resolved one at a time via
  // offerNextReward, so a reward nothing can use only forfeits *that* entry, not any others queued
  // behind it.
  private pendingRewardQueue: PendingReward[] = []
  // Set only while a reward is actively being offered, so submitMove can tell whether the move it's
  // about to apply is claiming a reward - and if so, whether it claimed the *whole* grant or only
  // split off part of it (in which case the remainder needs re-queuing, excluding the piece that
  // just moved - see submitMove's own reward-handling block).
  private currentRewardGrant: PendingReward | null = null
  // PK2/PK6a: the black die only rolls once per actual turn - skipped on the bonus turn granted by
  // a double, verified directly against the reference implementation's turn controller
  // ("if (!obj_dado.tiene_otro_turno && parkiSigueVivo(...))"). Set by endTurn() for the *next*
  // requestRoll() to read.
  private nextRollIsBonusTurn = false
  // PK6/PK8: a common piece can only eliminate the Parkiller during the roll that just produced
  // doubles - verified directly against the reference's doblete_mata_parkiller flag, which opens on
  // any double and closes again after the very first subsequent piece move (capture or not).
  private parkillerCapturableThisRoll = false
  // The barrier position offerMoves() most recently computed (PK9.1's own obligation) - kept as a
  // field, not a local, so submitMove() can tell whether the move it's about to apply is the one
  // breaking that barrier. Null whenever no barrier obligation was active on the last offerMoves()
  // call. A barrier can be on the shared track or in the player's own home corridor (PC2.4's own
  // rulebook text: a double forces the player to open a barrier "including those in the finish
  // zone") - `kind` distinguishes the two since track positions and corridor positions are
  // separate numeric spaces that can otherwise collide on the same number.
  private lastOfferedBarrierPosition: BarrierLocation | null = null
  // PK9.1's own "IMPORTANT!" qualifier: breaking a barrier with one half of a double forbids using
  // the double's *other* half to put the barrier's other original pawn right back onto the same
  // square, recreating it - confirmed directly in the client's own rulebook ("you cannot recreate
  // the barrier using the same double"). Sized to the exact square the break landed on, not a
  // boolean flag, since offerMoves() needs to exclude only *that* specific destination for *that*
  // specific piece, not restrict the second die generally.
  private brokenBarrierThisRoll: (BarrierLocation & { resultingTrackPosition: number; resultingCorridorPosition: number }) | null = null

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
    this.brokenBarrierThisRoll = null

    // PC 6.2: collecting a reward takes priority over any dice still unspent - if the Parkiller's
    // own move just eliminated an opposing Parkiller, its PK7 reward is offered ahead of the
    // white-dice move choices below, same as a regular capture's reward already is in submitMove().
    // offerReward()'s own fallback (continueAfterMove()) already knows how to fall through to
    // offerMoves() once the reward is spent or forfeited.
    if (parkillerResult.capturedParkillerColor) {
      this.pendingRewardQueue.push({ reason: 'capture', amount: REWARD_UNIT * 2 })
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
    // Not block-scoped - the capturedParkillerColor resolution below also needs to know whether a
    // pawn is already here too (see its own comment on why an already-paired square breaks its
    // safe-square exception the same way).
    const piecesThere: Piece[] = []
    for (const p of this.players) {
      for (const piece of p.pieces) {
        if (piece.state === 'OnTrack' && piece.trackPosition === after) piecesThere.push(piece)
      }
    }
    {
      // PK4/PK5: a protected square only shields a *lone* pawn from the Parkiller - it lands and
      // the two simply form a barrier instead of a capture (PK5's own "except in protected zones,
      // where it would form a barrier with that pawn"). It does NOT shield an existing full 2-pawn
      // barrier the Parkiller then lands on top of - PK5/PK10 both describe that landing as always
      // eliminating exactly one, with no protected-square exception carved out for it (verified
      // directly against the reference implementation's own ingresaFicha(), whose very first check
      // is `isParkiller && ds_list_size(fichasActualmente) >= 2` - unconditional on the square's own
      // protected flag). Gating the whole block on safeTrackIndices, as an earlier version of this
      // did, let a Parkiller land on a protected 2-pawn barrier with no resolution at all, leaving 3
      // pieces stacked on one square - reported directly with a screenshot.
      //
      // Reported directly ("Debe dejarme mover también alguno de los peones que forman la
      // barrera... no puede ser"), then reproduced via a stress test: PK5/PK10's "always eliminates
      // exactly one" is about the Parkiller landing on an *opposing or mixed* barrier - it never
      // covers landing on the mover's *own* same-color barrier (2 of the mover's own pawns,
      // BARRIERS-page case 1). resolveBarrierElimination's "both match the mover's color" branch
      // exists only to break a tie between two barrier pieces that both happen to share a *third*
      // color, and was never meant to fire when that shared color *is* the mover's own - it would
      // otherwise pick one of the mover's own two pawns via nothing but arrival order and eliminate
      // it, an own-color self-elimination the rulebook has no mechanic for at all. The player's own
      // Parkiller joining its own 2-pawn barrier is exactly BARRIERS-page case 3 with an extra own
      // pawn along for the ride - harmless, no elimination, same as the ordinary lone-pawn case.
      const ownBarrier = piecesThere.length >= 2 && piecesThere.every((p) => p.color === player.color)
      const target = ownBarrier
        ? null
        : piecesThere.length >= 2
          ? resolveBarrierElimination(player.color, piecesThere)
          : this.board.safeTrackIndices.has(after)
            ? null
            : (piecesThere.find((p) => p.color !== player.color) ?? null)
      if (target) {
        target.state = 'InYard'
        target.trackPosition = -1
        capturedPawn = target
      }
    }

    // Client's own "BARRIERS" rules page, case 4 ("Two Parkis - can only be formed on a safe
    // space"): two opposing Parkillers landing together are exactly as real a barrier as any other
    // pairing on this page, with the same safe-square gate every other mixed pairing above already
    // gets - this was the one case missing it, unconditionally eliminating the opposing Parkiller
    // even on a protected square instead of letting the two simply coexist there.
    //
    // Reported directly, via a stress test simulating full games: the safe-square exception above
    // was scoped to a *lone* opposing Parkiller (mirrors the pawn block above, which never lets its
    // own safe-square exception cover an already-full 2-occupant square either) - flagged, when
    // that exception first shipped, as a deeper edge case left unhandled like this file's other
    // explicitly out-of-scope PK10.1/PK10.2 cases. Concrete stress-test evidence means it's not
    // nearly as rare as it looked on paper: a lone pawn and an opposing Parkiller already
    // peacefully sharing a safe square (case 5) is itself an ordinary, common state, and *any*
    // third color's Parkiller landing there too hits exactly this gap. The rulebook doesn't specify
    // which of the two existing occupants a third Parkiller's arrival should resolve in this exact
    // three-way case - eliminating the found opposing Parkiller specifically (never the pawn) is a
    // deliberate, consistent choice: it matches PK6/PK7's own "landing on an opposing Parkiller
    // eliminates it" priority, grants that same PK7 reward, and never needs to weigh the existing
    // pawn's own color against the mover's, which pawn-vs-pawn barrier elimination (above) can do
    // but this file has no equivalent "arrival order" concept for Parkillers to fall back on.
    let capturedParkillerColor: PieceColor | null = null
    for (const opponent of this.players) {
      if (opponent.color === player.color) continue
      if (isParkillerOnTrack(opponent.parkiller) && opponent.parkiller.trackPosition === after) {
        const alreadyPairedWithSomethingElse = piecesThere.length >= 1
        if (alreadyPairedWithSomethingElse || !this.board.safeTrackIndices.has(after)) {
          opponent.parkiller.state = 'Eliminated'
          capturedParkillerColor = opponent.color
        }
        break
      }
    }

    return { capturedPawn, capturedParkillerColor }
  }

  // Client's own corrected rulebook (rules.pdf, "OPENING A BARRIER" - "THERE ARE TWO WAYS TO
  // OPEN A BARRIER"): a barrier blocks the path outright, including for the two pieces that *are*
  // the barrier - a normal move simply has no legal option for either of them, full stop, not even
  // a capture escape hatch. The only two ways out are a double (offerMoves() below, forces one
  // open) or an opposing Parki interacting with the square (landing on it eliminates one, per
  // resolveParkillerCollisions - already unaffected by this, since the Parki's own black die is
  // never subject to offerMoves()/offerReward() at all). Computed fresh on every call, not cached,
  // since a barrier can form or break mid-roll.
  // Reported directly, via a systematic rules audit Carlos himself requested: `ownBarrierCorridor`
  // used to only ever get computed `ownBarrierTrack === null ? ... : null` - the instant a player
  // also had a barrier on the shared track, their own separate corridor barrier (a fully legitimate
  // simultaneous state, using all 4 of a color's own pieces - 2 in each) went completely invisible
  // to this check, silently unlocking it on a non-double roll. Verified directly: a Red with a
  // track barrier at position 5 AND a corridor barrier at corridor index 1 offered real, legal
  // CorridorMove options for the corridor-barrier pieces on a plain [3, 2] roll. Both barrier kinds
  // are independent detectors (ownBarrierTrackPosition/ownCorridorBarrierPosition each only ever
  // scan this same player's own 4 pieces) and can coexist - computing both unconditionally fixes
  // this for both callers of this method (offerMoves' own excludeLockedBarrierPieces below, and
  // offerReward's own excludeBarrierAndSpentPiece, which share this exact helper).
  private pieceIsInOwnBarrier(piece: Piece): boolean {
    const ownBarrierTrack = ownBarrierTrackPosition(this.currentPlayer)
    const ownBarrierCorridor = ownCorridorBarrierPosition(this.currentPlayer)
    return (
      (ownBarrierTrack !== null && piece.state === 'OnTrack' && piece.trackPosition === ownBarrierTrack) ||
      (ownBarrierCorridor !== null && piece.state === 'InHomeCorridor' && piece.corridorPosition === ownBarrierCorridor)
    )
  }

  private offerMoves() {
    const state = this.diceState
    if (!state) return

    // See pieceIsInOwnBarrier's own doc comment - unlike offerReward's own unconditional exclusion
    // below, a double is the one case where a barrier piece *should* stay eligible (that's the
    // "roll a double" way of opening it, per the rulebook's own two options) - the double-forces-
    // open branch further down needs exactly this same "is there currently an own barrier" answer.
    //
    // barrierExcludedAnyMove (see MoveNotPossibleReason) tracks whether this filter actually threw
    // out a real candidate this roll, so the moveNotPossible check further down can tell a genuine
    // barrier-forfeited roll apart from a roll that never had anything to offer in the first place.
    let barrierExcludedAnyMove = false
    const excludeLockedBarrierPieces = (moves: MoveOption[]) => {
      if (state.dieA === state.dieB) return moves
      const filtered = moves.filter((m) => !this.pieceIsInOwnBarrier(m.piece))
      if (filtered.length < moves.length) barrierExcludedAnyMove = true
      return filtered
    }

    const dieAMoves = !state.dieAUsed
      ? excludeLockedBarrierPieces(getValidMoves(this.board, this.currentPlayer, this.players, state.dieA, this.settings, 'dieA'))
      : null
    const dieBMoves = !state.dieBUsed
      ? excludeLockedBarrierPieces(getValidMoves(this.board, this.currentPlayer, this.players, state.dieB, this.settings, 'dieB'))
      : null
    // Only ever a candidate move source before either die is individually spent - same precondition
    // the sum-move computation further down already required.
    const sumMoves =
      !state.dieAUsed && !state.dieBUsed
        ? excludeLockedBarrierPieces(getValidMoves(this.board, this.currentPlayer, this.players, state.dieA + state.dieB, this.settings, 'sum'))
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
    // PC2.1 also names the sum ("a die shows a 5, or the sum is 5") as its own, equally valid exit
    // trigger, not just a single die - reported directly ("si sale 5 y quedan peones en el refugio
    // deben salir"): with dieA=4/dieB=1, neither die alone is the exit roll, so the single-die-only
    // checks above missed it entirely, and the player could dodge the exit outright by moving two
    // other pieces with the 4 and the 1 individually - the sum itself was never touched, let alone
    // obligated. Only meaningful when neither die already carries the narrower single-die lock
    // above (that case is already fully handled, and using the sum then would just let a single die's
    // own lock be bypassed by spending both dice on one already-in-play piece instead).
    const sumHasExit =
      !dieAHasExit && !dieBHasExit && state.dieA + state.dieB === this.settings.exitRoll && (sumMoves?.some((m) => m.kind === 'ExitYard') ?? false)
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
    //
    // A track barrier and a corridor barrier existing *simultaneously* is a rare enough edge case
    // (the player would need two separate own-pairs stacked in two different places at once) that
    // this picks the track one first, matching this obligation's own pre-corridor-barrier
    // precedent, rather than adding a rule the client's own text never actually addresses.
    const ownBarrierTrack = ownBarrierTrackPosition(this.currentPlayer)
    const ownBarrierCorridor = ownBarrierTrack === null ? ownCorridorBarrierPosition(this.currentPlayer) : null
    const barrierLocation: BarrierLocation | null =
      state.dieA !== state.dieB
        ? null
        : ownBarrierTrack !== null
          ? { kind: 'track', position: ownBarrierTrack }
          : ownBarrierCorridor !== null
            ? { kind: 'corridor', position: ownBarrierCorridor }
            : null
    this.lastOfferedBarrierPosition = barrierLocation
    const pieceIsAtBarrier = (piece: Piece): boolean =>
      barrierLocation !== null &&
      (barrierLocation.kind === 'track'
        ? piece.state === 'OnTrack' && piece.trackPosition === barrierLocation.position
        : piece.state === 'InHomeCorridor' && piece.corridorPosition === barrierLocation.position)
    const restrictToBarrierBreakOrCapture = (moves: MoveOption[]) =>
      moves.filter((m) => pieceIsAtBarrier(m.piece) || wouldCapture(this.board, m, this.players, this.parkillerCapturableThisRoll))
    const applyObligations = (moves: MoveOption[], dieHasExit: boolean): MoveOption[] => {
      if (barrierLocation !== null) {
        const barrierMoves = restrictToBarrierBreakOrCapture(moves)
        if (barrierMoves.length > 0) return barrierMoves
      }
      // sumHasExit restricts every move source alike, not just the sum's own moves - using either
      // individual die on some other, non-capturing piece would just dodge the sum-only exit the
      // same way a single die's own dieHasExit lock already prevents for that one die.
      return dieHasExit || sumHasExit ? restrictToExitOrCapture(moves) : moves
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
    // either obligation by spending both dice on a single already-in-play piece instead. Still
    // routed through applyObligations even here (dieHasExit=false, but sumHasExit is checked inside
    // it too) so a sum-only exit obligation restricts the sum's own other move options exactly like
    // it now restricts dieA/dieB's.
    if (dieAMoves && dieBMoves && !dieAHasExit && !dieBHasExit && barrierLocation === null && sumMoves) {
      addMoves(applyObligations(sumMoves, false))
    }

    let options = [...byPieceAndAmount.values()]

    // PK9.1's own "IMPORTANT!" qualifier: once a double breaks a barrier, that double's other half
    // can't put the barrier's other original pawn right back onto the exact square the first one
    // just landed on - that would just recreate the barrier this same obligation forced open a
    // moment ago. Only that one specific (piece, destination) pairing is excluded - the piece is
    // still completely free to land anywhere else.
    if (this.brokenBarrierThisRoll) {
      const broken = this.brokenBarrierThisRoll
      options = options.filter((m) => {
        const sameOrigin =
          broken.kind === 'track'
            ? m.piece.state === 'OnTrack' && m.piece.trackPosition === broken.position
            : m.piece.state === 'InHomeCorridor' && m.piece.corridorPosition === broken.position
        return !(sameOrigin && m.resultingTrackPosition === broken.resultingTrackPosition && m.resultingCorridorPosition === broken.resultingCorridorPosition)
      })
    }

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
      this.moveNotPossible.emit(barrierExcludedAnyMove ? 'barrier' : 'none')
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
    // PK9.1's own "IMPORTANT!" qualifier (see brokenBarrierThisRoll's own comment): this move just
    // broke an own-color barrier if it started exactly on the square offerMoves() most recently
    // flagged as one, on a double (barrier-break obligation is only ever offered on a double, and
    // never via the sum, so this can't misfire on an unrelated own-color pair coincidentally
    // sharing a square for some other reason).
    const brokenLocation = this.lastOfferedBarrierPosition
    const startedAtBarrier =
      brokenLocation !== null &&
      (brokenLocation.kind === 'track'
        ? before.state === 'OnTrack' && before.trackPosition === brokenLocation.position
        : before.state === 'InHomeCorridor' && before.corridorPosition === brokenLocation.position)
    if (!isRewardMove && this.diceState && this.diceState.dieA === this.diceState.dieB && startedAtBarrier && brokenLocation) {
      this.brokenBarrierThisRoll = {
        ...brokenLocation,
        resultingTrackPosition: move.resultingTrackPosition,
        resultingCorridorPosition: move.resultingCorridorPosition,
      }
    }
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
      eliminatedByParkillerAt: result.eliminatedByParkillerAt,
      eliminatedByParkillerColor: result.eliminatedByParkillerColor,
    })

    if (hasWon(this.currentPlayer)) {
      this.gameWon.emit(this.currentPlayer)
      return result
    }

    // This move claimed (part of) an active reward grant - if it only took the smaller, split-off
    // amount (10 out of a capture's own 20), the rest is still owed, excluding this piece from
    // taking it too ("another pawn" - see PendingReward's own comment). Checked before queueing any
    // *new* reward below, so a capture-during-a-reward-chain still stacks on top of this remainder
    // rather than ahead of it (pendingRewardQueue is drained front-to-back).
    if (isRewardMove && this.currentRewardGrant) {
      const grant = this.currentRewardGrant
      this.currentRewardGrant = null
      if (move.amount < grant.amount) {
        this.pendingRewardQueue.push({ reason: grant.reason, amount: grant.amount - move.amount, excludePiece: chosenPiece })
      }
    }

    // PC 3/PC 4: capturing or finishing earns a reward, and PC 6.2 places collecting it ahead of
    // any dice still unspent. A move landing on this same reward can itself capture again, in
    // which case PC 5 adds the new reward on top rather than replacing it. PK7 rewards eliminating
    // an opposing Parkiller the same way a regular capture does.
    if (result.capturedPiece || result.capturedParkillerColor) this.pendingRewardQueue.push({ reason: 'capture', amount: REWARD_UNIT * 2 })
    if (result.pieceFinished) this.pendingRewardQueue.push({ reason: 'finish', amount: REWARD_UNIT })

    this.offerNextReward()
    return result
  }

  // Drains pendingRewardQueue one grant at a time - each grant gets its own independent
  // offerReward call (own mandatory-if-possible check, own forfeit if not), rather than resolving
  // the whole queue as one lump sum. Falls through to continueAfterMove once nothing's left owed,
  // whether that's because the queue started empty (an ordinary move) or just ran dry.
  private offerNextReward() {
    const grant = this.pendingRewardQueue.shift()
    if (!grant) {
      this.continueAfterMove()
      return
    }
    this.offerReward(grant)
  }

  // Offers a bonus move for the current reward grant - restricted (via getValidMoves' own exitRoll
  // check) to pieces already in play, per PC 5 ("you cannot remove a pawn from the shelter... and
  // then claim it"). If nothing can use it, PC 5 forfeits the whole grant rather than holding it
  // for later, then moves on to whatever else is still queued. Deliberately not subject to
  // mandatory capture (verified against the reference: reward moves let the player pick freely
  // which piece to advance, capture available or not).
  //
  // Reported directly ("장벽이 형성되였을때 주사위가 더블이 되지도않앗는데 장벽에서 나오는경황이있었다"
  // - a piece came out of a barrier even though the dice weren't a double): unlike offerMoves()'s
  // own dieA/dieB/sum moves, this never excluded a piece sitting in the player's own barrier at
  // all - a reward can be granted on *any* roll (a regular capturing move, or even a Parkiller-vs-
  // Parkiller kill resolved before offerMoves() ever runs), completely independent of whether that
  // roll happened to be a double. Since "roll a double" and "an opposing Parki" are the rulebook's
  // own *only* two ways to open a barrier (rules.pdf, "OPENING A BARRIER") - a bonus/reward move,
  // spending accumulated squares rather than a die's own face value, is neither - this always
  // excludes a barrier piece, with no double-based exception the way offerMoves() has one: even on
  // a double roll, by the time any reward could be offered the mandatory barrier-break obligation
  // (PK9.1, handled entirely inside offerMoves() before a capturing move could even be submitted)
  // has already necessarily run its course.
  //
  // A splittable grant (a fresh capture's own 20 - see PendingReward's own comment for why this
  // isn't forced down one fixed path) offers *both* amounts together: every piece that can move
  // the full grant amount in one go, and every piece that can move exactly REWARD_UNIT instead -
  // same amount-keyed-per-piece pattern offerMoves() already uses for dieA/dieB/sum, so a piece
  // reachable both ways keeps both options rather than collapsing to one. Picking the smaller
  // amount leaves the rest queued (handled back in submitMove, right after this move applies);
  // picking the full amount resolves the whole grant in this one move.
  private offerReward(grant: PendingReward) {
    const canSplit = grant.reason === 'capture' && grant.amount > REWARD_UNIT
    const excludePiece = grant.excludePiece
    const excludeBarrierAndSpentPiece = (moves: MoveOption[]) =>
      moves.filter((m) => m.piece !== excludePiece && !this.pieceIsInOwnBarrier(m.piece))
    const fullMoves = excludeBarrierAndSpentPiece(
      getValidMoves(this.board, this.currentPlayer, this.players, grant.amount, this.settings, 'reward'),
    )
    const splitMoves = canSplit
      ? excludeBarrierAndSpentPiece(getValidMoves(this.board, this.currentPlayer, this.players, REWARD_UNIT, this.settings, 'reward'))
      : []

    const byPieceAndAmount = new Map<string, MoveOption>()
    const addMoves = (moves: MoveOption[]) => {
      for (const move of moves) {
        const key = `${move.piece.color}:${move.piece.pieceIndex}:${move.amount}`
        if (!byPieceAndAmount.has(key)) byPieceAndAmount.set(key, move)
      }
    }
    addMoves(fullMoves)
    addMoves(splitMoves)
    const moves = [...byPieceAndAmount.values()]

    if (moves.length === 0) {
      this.rewardForfeited.emit({ amount: grant.amount, reason: grant.reason })
      this.offerNextReward()
      return
    }
    this.pendingMoves = moves
    this.currentRewardGrant = grant
    this.rewardOffered.emit({ amount: grant.amount, reason: grant.reason })
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
