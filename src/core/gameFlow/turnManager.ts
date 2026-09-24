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
import { determineStartingPlayer as computeStartingPlayer, type StartingPlayerResult } from './startingPlayer'

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
 * mover ninguno de los dos peones... no ha manera"): a wasted roll used to look identical to a
 * roll that genuinely had nothing to move, and the turn just silently passed either way with zero
 * on-screen explanation. Only ever 'none' now - see offerMoves()'s own doc comment on barriers: a
 * normal roll can freely move a barrier piece (the player's own choice), so a barrier alone no
 * longer forces a wasted roll the way it used to.
 * Kept as a named reason (rather than inlining a plain boolean) since GameBoardScreen still branches
 * on it to show an explanatory message instead of the turn just silently advancing, and a future
 * distinct reason may still want to reuse this same plumbing. */
export type MoveNotPossibleReason = 'none'

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
  /** Client's own "Special Situations" guide, "PARKI REMOVES TWO PARKIS": two opposing Parkis
   * already paired on one square (BARRIERS page case 4 - only possible on a safe square) are both
   * eliminated at once when a *third* Parki lands there, not just one - the general "landing on an
   * existing barrier always eliminates exactly one" rule (PK5/PK10) turns out to have this one
   * documented exception once the landing piece is itself a Parki. Only ever set alongside
   * capturedParkillerColor (the first of the two, by scan order - see resolveParkillerCollisions).
   */
  secondCapturedParkillerColor?: PieceColor | null
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
  /** Set on the second exit of a double exit-roll that TurnManager played out for the player in the
   * same call as the first (see doubleExitPairable) - the scene layer plays both hops together
   * instead of one after the other. Always immediately follows the first move's own event. */
  simultaneousWithPrevious?: boolean
}

// 'parkillerCapture' split off from the plain 'capture' reason - reported directly ("¿ELIMINAR UN
// PEON, UN PARKI... DEBEN SER FESTEJADAS... CADA MOVIMIENTO SEPARADO" - eliminating a pawn, a
// Parki... they should be celebrated, each move separately - see botController.ts's own doc
// comment quoting this in full): eliminating an opposing Parkiller (PK6: a pawn kills it, PK7: a
// Parkiller kills it) shared this exact same reason value with an everyday pawn capture, so every
// listener that reads it - RewardToast's own label, RewardBurst's own spark/ring styling - had no
// way to tell the two apart and showed the same generic "¡Captura!" treatment for both, even though
// the client explicitly treats a Parkiller kill as the bigger, separately-noteworthy event. The
// reward math itself (amount, split-into-two-10s eligibility) stays identical to a plain capture -
// only the *display* reason changes - so every place that keys off 'capture' to decide behavior
// rather than just cosmetics (offerReward's own canSplit, GameBoardScreen's own fanfare-vs-finish-
// sound choice) was updated to treat 'parkillerCapture' the same way it already treats 'capture'.
export type RewardReason = 'capture' | 'parkillerCapture' | 'finish'

// The amount actually being offered *this* time - RewardToast/RewardBurst (and every other
// external listener) only ever need to know what's on the table right now, not the internal
// bookkeeping of whether it's the first half of a capture's own 20, a re-offered remainder, or a
// finish's own flat 10.
export interface RewardGrant {
  amount: number
  reason: RewardReason
}

// PENDING_REWARD's own internal bookkeeping, on top of RewardGrant - see PendingReward's own
// history in this file's git log for why there's no excludePiece field here anymore: the
// remaining half of a split reward used to be restricted to "another pawn" (the rulebook's own
// wording for the split option), but reported directly - "PERO SI CAMBIAS DE OPINION Y QUEDAN 10
// POR MOVER DEBES PODER HACERLO CON EL PEON QUE QUIERAS, INCLUSO CON EL MISMO" (but if you change
// your mind and there are 10 left to move, you should be able to do it with whichever pawn you
// want, even the same one) - the client's own explicit correction, overriding that earlier literal
// reading. The remaining 10 is now offered to every eligible piece, the one that already took the
// first 10 included.
type PendingReward = RewardGrant

// PC 3/PC 4/PK7/PK8's reward size, in squares - a capture (own or via the Parkiller) is worth 20,
// a finish worth 10 (a flat, non-splittable single unit either way).
//
// A capture's own 20 is a genuine *choice*, not a forced split - confirmed directly in the
// client's own corrected rulebook (rules.pdf, "Bonus" pages, present on every one of Pawn
// Capture/Parki Elimination/Bonuses): "Choose one: Move one Pawn 20 spaces. OR Move one Pawn 10
// spaces and another pawn 10 spaces." offerReward offers *both* a 20-in-one-piece move and a
// 10-in-one-piece move together (same amount-keyed pattern offerMoves already uses for dieA/
// dieB/sum) - picking the 20 outright resolves the whole reward in one move, matching the
// rulebook's own first option exactly; picking the 10 re-offers the remaining 10 to every still-
// eligible piece (see PendingReward's own doc comment above - including the piece that just moved,
// per the client's own direct correction).
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
  // any double. Stays open for the *whole* roll now (see 807a8da's own commit message for why an
  // earlier version of this comment's "closes after the very first move" was itself wrong) - both
  // of the double's own dice get a real, independent shot at it; see piecesMovedThisRoll just below
  // for the actual, current narrowing on that.
  private parkillerCapturableThisRoll = false
  // Reported directly ("SALIO UN DOBLE 2 Y EL PARKI ESTABA A 4. MOVIO DOS, AL MOVER LOS OTROS DOS
  // DEBIA MORIR POR EL PARKI...NO OCURRIO ESTO SINO QUE ELIMINO AL PARKI...AL PARKI SE LE ELIMINA SI
  // SALE EL DOBLE DE LA DISTANCIA HACIA EL. NO LA SUMA" - see wouldCapture's own matching parameter
  // (parchisRules.ts) for the full reasoning. Every piece this roll's own moves have already been
  // applied to, tracked here (not just whichever one is "current") because a double's two identical
  // dice could move two entirely different pieces, and only THIS SAME piece moving twice is the
  // "really just the sum, split into two hops" case that must NOT still count as a single-die
  // distance match. Cleared at the start of every requestRoll(), same as preRollBarrierCaptured.
  private piecesMovedThisRoll = new Set<Piece>()
  // The barrier position offerMoves() most recently computed (PK9.1's own obligation) - kept as a
  // field, not a local, so submitMove() can tell whether the move it's about to apply is the one
  // breaking that barrier. Null whenever no barrier obligation was active on the last offerMoves()
  // call. A barrier can be on the shared track or in the player's own home corridor (PC2.4's own
  // rulebook text: a double forces the player to open a barrier "including those in the finish
  // zone") - `kind` distinguishes the two since track positions and corridor positions are
  // separate numeric spaces that can otherwise collide on the same number.
  private lastOfferedBarrierPosition: BarrierLocation | null = null
  // Reported directly by the client, with a chat transcript: PK9.1's "a double obligates breaking
  // an existing barrier" was firing for a barrier the roll's *own* first die had just formed a
  // moment earlier - "cuando la barrera se crea con una tirada no hay obligación de abrirla con el
  // valor del otro dado... tiene que haber la opción de mover otro peón" (when the barrier is
  // created by this same roll, there's no obligation to open it with the other die - there has to
  // be the option to move a different piece). The rulebook's own wording ("if a barrier was present
  // at the start of the move") only ever meant a barrier that already existed *before* this roll -
  // "si ya hay una barrera formada y te sale un doble sí estás obligado" (if a barrier is *already*
  // formed and you roll a double, yes you're obligated). offerMoves()'s own barrierLocation below
  // only treats a *currently* detected barrier as this obligation if it matches this snapshot, so a
  // barrier the roll's own white-dice choices just created is a free choice, never a forced one.
  //
  // Captured lazily - the *first* time offerMoves() runs each roll, not eagerly at requestRoll()'s
  // own top - specifically so it still includes the automatic Parkiller move and any Parkiller-kill
  // reward chain, both of which resolve before offerMoves() is ever reached but are not the
  // player's own white-dice choice: the existing "pawn+own-Parkiller barrier" test below relies on
  // exactly this (the black die walks the Parkiller onto a pawn's square *this same roll*, and that
  // pairing must still obligate the white dice, unlike a barrier the white dice create themselves).
  private preRollBarrierLocation: BarrierLocation | null = null
  private preRollBarrierCaptured = false
  // PK9.1's own "IMPORTANT!" qualifier: breaking a barrier with one half of a double forbids using
  // the double's *other* half to put the barrier's other original pawn right back onto the same
  // square, recreating it - confirmed directly in the client's own rulebook ("you cannot recreate
  // the barrier using the same double"). Sized to the exact square the break landed on, not a
  // boolean flag, since offerMoves() needs to exclude only *that* specific destination for *that*
  // specific piece, not restrict the second die generally.
  private brokenBarrierThisRoll: (BarrierLocation & { resultingTrackPosition: number; resultingCorridorPosition: number }) | null = null
  // Client's own "Special Situations" guide: the entry track square this same roll's own earlier
  // exit already cleared an opposing pawn from, leaving that pawn's own Parkiller alone there
  // (page 3/page 4's "double 5 removes both" - the pawn on the first exit, the Parkiller on the
  // second). applyMove needs this to tell that specific, same-roll history apart from an
  // unrelated, genuinely pre-existing pawn+Parkiller pairing elsewhere, which keeps its own
  // "bounces the joining pawn home" resolution (the sibling "3-stack" test). Reset at the start of
  // every roll, same as brokenBarrierThisRoll just above.
  private openedEntryPairThisRoll: number | null = null
  // Reported directly ("Si sale un doble 5 y quedan dos peones en el refugio. Ambos salen a la vez
  // salvo que ya haya otro en la casilla de salida. NO uno detrás de otro" - on a double 5 with two
  // pawns still in the shelter, both come out at once unless another pawn is already on the exit
  // square; not one after the other): the two exits used to be two separate clicks and two separate
  // hops. Set by playMove() after a plain, uneventful exit made with one half of a double exit-roll
  // onto an empty square (anything already there - the "already another one there" the client
  // excepts - keeps the two exits one at a time, as does a capture, which owes its own reward first),
  // and consumed by the very next offerMoves(): if all that's left for the other die is another exit,
  // it is played out right there for the player - the shelter pawns are interchangeable, so there is
  // nothing to choose. Cleared at every requestRoll() and by any move that isn't such an exit.
  private doubleExitPairable = false

  // `dice` accepts anything roll()-shaped, not just the real Dice class - tests inject an exact
  // roll queue instead of a seed, since a seed's resulting face values aren't hand-pickable.
  constructor(board: BoardData, players: PlayerState[], settings: RuleSettings, dice: DiceLike = new Dice()) {
    this.board = board
    this.players = players
    this.settings = settings
    this.dice = dice
  }

  // Requested directly ("Debe poder ser reemplazado por el bot hasta que tome el control en la
  // siguiente tirada" - it should be replaceable by a bot until they take control again on the
  // next roll): when the room's own Master disconnects, another client is promoted to take over
  // authority instead of just ending the game (OnlineLobbyScreen.tsx's own onMasterClientChanged
  // handler) - that promoted client already has this *exact* TurnManager instance, kept correctly
  // in sync the whole game by replaying every broadcast against it (RemoteTurnManager's own doc
  // comment), with every bit of internal state (currentPlayerIndex, consecutiveDoubles,
  // parkillerCapturableThisRoll, piecesMovedThisRoll, ...) already exactly right - reusing it
  // outright, rather than constructing a fresh TurnManager and trying to reconstruct all of that
  // by hand, is what makes this promotion safe. The one thing that has to change is this instance's
  // own dice source: it was built with a QueueDice (fed only by replaying the old Master's own
  // broadcast values, never rolling anything itself) - the newly-promoted client needs a real
  // RecordingDice instead, the same kind HostTurnManagerBridge already wraps every dieA/dieB/
  // blackDie call in for a fresh game's own Master.
  replaceDice(dice: DiceLike): void {
    this.dice = dice
  }

  get currentPlayer(): PlayerState {
    return this.players[this.currentPlayerIndex]
  }

  // Requested directly ("cada jugador y los bots lanzan los dados blancos para indicar quien
  // comienza la partida"): rolls the white dice once per player (see startingPlayer.ts's own doc
  // comment for the tie-break) and sets currentPlayerIndex to whoever rolled highest - call this
  // *before* start(), or the very first turnStarted still fires for whichever player happened to
  // be listed first. Optional precisely so every existing test that doesn't care who goes first
  // can keep relying on the old, deterministic "players[0] starts" behavior unchanged.
  determineStartingPlayer(): StartingPlayerResult {
    const result = computeStartingPlayer(this.players, this.dice)
    this.currentPlayerIndex = result.winnerIndex
    return result
  }

  start() {
    this.turnStarted.emit(this.currentPlayer)
  }

  requestRoll() {
    // See preRollBarrierLocation's own doc comment - captured lazily, the first time offerMoves()
    // runs this roll (see there), not here: the automatic Parkiller move and any Parkiller-kill
    // reward chain both still count as "before this roll's own white-dice choices," per the
    // existing pawn+own-Parkiller barrier test below.
    this.preRollBarrierCaptured = false

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
    // See this field's own doc comment above - a fresh roll (including a bonus turn's own new roll
    // after an earlier double) starts with nothing yet moved, same scope as parkillerCapturableThisRoll.
    this.piecesMovedThisRoll = new Set()

    if (dieA === dieB) {
      this.consecutiveDoubles++
      // Reported directly ("SI SALEN DOBLES Y NO SE PUEDE MOVER PORQUE ESTAN EN CASA SE LANZAN LOS
      // DADOS DE NUEVO... NO SOLO TRES VECES...HASTA QUE NO SALGAN DOBLES" - if doubles come up and
      // you can't move because your pieces are still at home, roll again; not capped at three times,
      // keep going until doubles stop coming up): this used to reset consecutiveDoubles to 0 the
      // instant the streak hit 3, regardless of whether an elimination actually happened - a stuck
      // player (every piece still in the yard, none of three straight doubles matching the exit
      // roll) has no lastMovedPiece at all, so the elimination below never fires, but the streak
      // still silently reset - and finishDiceUsage()'s own `grantExtraTurn = consecutiveDoubles > 0`
      // read that fresh 0 right afterward, on this exact roll, ending the turn instead of granting
      // the bonus reroll a double is always owed regardless of what could be done with it. The same
      // reset-without-eliminating bug affected the home-corridor exemption right below it too,
      // directly contradicting that branch's own comment ("the streak just continues"). Only
      // resetting the counter at the same point elimination actually happens - never independently
      // of it - fixes both: consecutiveDoubles keeps climbing on every further stuck (or exempt)
      // double, and finishDiceUsage() sees it's still > 0 and keeps granting rerolls until a
      // genuinely non-double roll or a real, eligible lastMovedPiece finally ends the streak.
      // Found while testing the fix above: a piece that already reached Finished is not
      // 'InHomeCorridor' either, so the exemption above alone would let a later, unrelated double
      // streak reach back and un-finish an already-completed piece - sending a piece that already
      // made it home *backward* isn't a sensible reading of this penalty under any rulebook
      // interpretation. Exempt for the same reason home-corridor pieces already are.
      if (
        this.settings.thirdConsecutiveDoubleEliminatesLastMoved &&
        this.consecutiveDoubles >= 3 &&
        this.lastMovedPiece &&
        this.lastMovedPiece.state !== 'InHomeCorridor' &&
        this.lastMovedPiece.state !== 'Finished'
      ) {
        this.consecutiveDoubles = 0
        this.lastMovedPiece.state = 'InYard'
        this.lastMovedPiece.trackPosition = -1
        this.lastMovedPiece.corridorPosition = -1
        this.pieceEliminatedByDoubles.emit(this.lastMovedPiece)
        this.lastMovedPiece = null
        this.endTurn(false)
        return
      }
    } else {
      this.consecutiveDoubles = 0
    }

    this.diceState = { dieA, dieB, dieAUsed: false, dieBUsed: false }
    this.brokenBarrierThisRoll = null
    this.openedEntryPairThisRoll = null
    this.doubleExitPairable = false

    // PC 6.2: collecting a reward takes priority over any dice still unspent - if the Parkiller's
    // own move just eliminated an opposing Parkiller, its PK7 reward is offered ahead of the
    // white-dice move choices below, same as a regular capture's reward already is in submitMove().
    // offerReward()'s own fallback (continueAfterMove()) already knows how to fall through to
    // offerMoves() once the reward is spent or forfeited.
    if (parkillerResult.capturedParkillerColor) {
      // PK7: a Parkiller-vs-Parkiller kill - its own distinct reason (see RewardReason's own doc
      // comment), not the plain 'capture' every ordinary pawn capture still uses.
      this.pendingRewardQueue.push({ reason: 'parkillerCapture', amount: REWARD_UNIT * 2 })
      // "PARKI REMOVES TWO PARKIS": each of the two eliminations earns its own reward, same as two
      // separate captures would - queued together and drained one grant at a time, same as any
      // other chain (see offerNextReward's own comment).
      if (parkillerResult.secondCapturedParkillerColor) {
        this.pendingRewardQueue.push({ reason: 'parkillerCapture', amount: REWARD_UNIT * 2 })
      }
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
      parkiller.arrivedAt = this.nextArrivalSequence++
      const { capturedPawn, capturedParkillerColor, secondCapturedParkillerColor } = this.resolveParkillerCollisions(player, after)
      return {
        color: player.color,
        before,
        after,
        beforeCorridorPosition,
        afterCorridorPosition: parkiller.corridorPosition,
        capturedPawn,
        capturedParkillerColor,
        secondCapturedParkillerColor,
      }
    }

    const after = mod(before - blackDieValue, this.board.trackLength)
    parkiller.trackPosition = after
    parkiller.arrivedAt = this.nextArrivalSequence++
    const { capturedPawn, capturedParkillerColor, secondCapturedParkillerColor } = this.resolveParkillerCollisions(player, after)
    return {
      color: player.color,
      before,
      after,
      beforeCorridorPosition,
      afterCorridorPosition: beforeCorridorPosition,
      capturedPawn,
      capturedParkillerColor,
      secondCapturedParkillerColor,
    }
  }

  private resolveParkillerCollisions(
    player: PlayerState,
    after: number,
  ): { capturedPawn: Piece | null; capturedParkillerColor: PieceColor | null; secondCapturedParkillerColor: PieceColor | null } {
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
    const opposingParkillersThere = this.players.filter(
      (opponent) => opponent.color !== player.color && isParkillerOnTrack(opponent.parkiller) && opponent.parkiller.trackPosition === after,
    )

    let capturedParkillerColor: PieceColor | null = null
    let secondCapturedParkillerColor: PieceColor | null = null
    // Client's own "Special Situations" guide, "PARKI REMOVES TWO PARKIS": two opposing Parkis
    // already paired together (BARRIERS page case 4 - only ever possible on a safe square, with no
    // pawn also there - piecesThere.length checked below to stay scoped to exactly that case) both
    // go at once when a third Parki lands on them, not just one. The three-way case this same
    // square could instead hold - a lone opposing Parki already paired with a *pawn* - is a
    // different, still-undocumented scenario (see this function's own comment above) and keeps its
    // existing single-elimination resolution untouched.
    if (opposingParkillersThere.length >= 2 && piecesThere.length === 0) {
      capturedParkillerColor = opposingParkillersThere[0].color
      secondCapturedParkillerColor = opposingParkillersThere[1].color
      opposingParkillersThere[0].parkiller.state = 'Eliminated'
      opposingParkillersThere[1].parkiller.state = 'Eliminated'
    } else if (opposingParkillersThere.length >= 1) {
      const opponent = opposingParkillersThere[0]
      const alreadyPairedWithSomethingElse = piecesThere.length >= 1
      if (alreadyPairedWithSomethingElse || !this.board.safeTrackIndices.has(after)) {
        opponent.parkiller.state = 'Eliminated'
        capturedParkillerColor = opponent.color
      }
    }

    return { capturedPawn, capturedParkillerColor, secondCapturedParkillerColor }
  }

  // Corrected directly by the client, reversing an earlier reading of rules.pdf's "OPENING A
  // BARRIER" page ("THERE ARE TWO WAYS TO OPEN A BARRIER" - a double, or an opposing Parki): that
  // page describes the two ways a barrier opens *involuntarily* (forced, no choice - a double
  // obligates it per PK9.1, a Parki simply eliminates one pawn outright), not the *only* ways it
  // can ever open at all. "La barrera se abre 'obligatoriamente e involuntariamente' si sale un
  // doble, pero el jugador puede abrirla cuando quiera" (the barrier opens "mandatorily and
  // involuntarily" on a double, but the player can open it whenever they want): a barrier only
  // ever blocks *other* pieces from landing on or passing through it - never its own occupants
  // from leaving voluntarily, on any kind of move (an ordinary die, the sum, or a reward - see
  // offerReward's own matching comment for why that one took a second, separate report to fix).
  //
  // Reported directly, via a systematic rules audit Carlos himself requested: `ownBarrierCorridor`
  // below used to only ever get computed `ownBarrierTrack === null ? ... : null` - the instant a
  // player also had a barrier on the shared track, their own separate corridor barrier (a fully
  // legitimate simultaneous state, using all 4 of a color's own pieces - 2 in each) went completely
  // invisible to this check. Both barrier kinds are independent detectors (ownBarrierTrackPosition/
  // ownCorridorBarrierPosition each only ever scan this same player's own 4 pieces) and can
  // coexist - computing both unconditionally fixes this.
  private offerMoves() {
    const state = this.diceState
    if (!state) return

    // A barrier piece is never excluded from an ordinary dieA/dieB/sum move just for sitting in a
    // barrier - the player can always choose to move it normally, on any roll. Only the double-forces-open
    // obligation further down (barrierLocation/applyObligations) ever *restricts* moves down to a
    // barrier-break when a barrier already exists, and that's a double-only, mandatory narrowing,
    // not an exclusion on every other roll.
    const isDoubleRoll = state.dieA === state.dieB
    const dieAMoves = !state.dieAUsed
      ? getValidMoves(this.board, this.currentPlayer, this.players, state.dieA, this.settings, 'dieA', isDoubleRoll)
      : null
    const dieBMoves = !state.dieBUsed
      ? getValidMoves(this.board, this.currentPlayer, this.players, state.dieB, this.settings, 'dieB', isDoubleRoll)
      : null
    // Only ever a candidate move source before either die is individually spent - same precondition
    // the sum-move computation further down already required.
    const sumMoves =
      !state.dieAUsed && !state.dieBUsed
        ? getValidMoves(this.board, this.currentPlayer, this.players, state.dieA + state.dieB, this.settings, 'sum', isDoubleRoll)
        : null

    // PC2.1: "A pawn must move to the starting square" whenever a die's own value is the exit
    // roll and a yard piece could use it - that die can only be spent on the exit, full stop, not
    // reassigned to a different piece by the same amount even when that move would capture.
    // Verified directly against the reference implementation's own activarFichasMovibles(): once
    // hayFichasEnCasaQuePuedenSalir is true, it unconditionally clears debe_mover for every
    // non-yard piece of that color for this die - no exception checked for a move that would have
    // captured. The rulebook's own PC2.1 text carries only one stated exception (the entry square
    // already full of the player's own two pawns), not an available capture elsewhere. An earlier
    // version of this code carved out captures here on the theory that PC3/PK8's own mandatory-
    // capture rule outranked this - unsupported by either source, and reverted. The *other* die
    // stays completely free, before or after, in either order (offerMoves runs fresh after every
    // move, so whichever die the player didn't spend just gets offered again next time around).
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
    const restrictToExit = (moves: MoveOption[]) => moves.filter((m) => m.kind === 'ExitYard')

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
    const liveBarrierLocation: BarrierLocation | null =
      state.dieA !== state.dieB
        ? null
        : ownBarrierTrack !== null
          ? { kind: 'track', position: ownBarrierTrack }
          : ownBarrierCorridor !== null
            ? { kind: 'corridor', position: ownBarrierCorridor }
            : null
    // See preRollBarrierLocation's own doc comment - captured from this exact same live check, but
    // only on the *first* offerMoves() call this roll (before any white-dice move has touched
    // anything), then reused unchanged on every later call this same roll.
    if (!this.preRollBarrierCaptured) {
      this.preRollBarrierLocation = liveBarrierLocation
      this.preRollBarrierCaptured = true
    }
    // Only a barrier that already existed before this roll's own white-dice choices is an
    // obligation; one this roll's own earlier die just formed is not.
    const barrierLocation: BarrierLocation | null =
      liveBarrierLocation !== null &&
      this.preRollBarrierLocation !== null &&
      liveBarrierLocation.kind === this.preRollBarrierLocation.kind &&
      liveBarrierLocation.position === this.preRollBarrierLocation.position
        ? liveBarrierLocation
        : null
    this.lastOfferedBarrierPosition = barrierLocation
    const pieceIsAtBarrier = (piece: Piece): boolean =>
      barrierLocation !== null &&
      (barrierLocation.kind === 'track'
        ? piece.state === 'OnTrack' && piece.trackPosition === barrierLocation.position
        : piece.state === 'InHomeCorridor' && piece.corridorPosition === barrierLocation.position)
    const restrictToBarrierBreakOrCapture = (moves: MoveOption[]) =>
      moves.filter((m) => pieceIsAtBarrier(m.piece) || wouldCapture(this.board, m, this.players, this.parkillerCapturableThisRoll, this.piecesMovedThisRoll))
    const applyObligations = (moves: MoveOption[], dieHasExit: boolean): MoveOption[] => {
      if (barrierLocation !== null) {
        const barrierMoves = restrictToBarrierBreakOrCapture(moves)
        if (barrierMoves.length > 0) return barrierMoves
      }
      // sumHasExit restricts every move source alike, not just the sum's own moves - using either
      // individual die on some other, non-capturing piece would just dodge the sum-only exit the
      // same way a single die's own dieHasExit lock already prevents for that one die.
      return dieHasExit || sumHasExit ? restrictToExit(moves) : moves
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
    //
    // Reported directly ("1+1 EN CAMINO DE LLEGADA SI ESTAN PARA LLEGAR, DEBEN ENTRAR LOS DOS" -
    // with double 1, two pawns each one square from finishing must both be able to finish):
    // m.kind !== 'FinishMove' below - every FinishMove uses the sentinel resultingTrackPosition=-1/
    // resultingCorridorPosition=<lane's own final index> (see parchisRules.ts's own move-building),
    // so two DIFFERENT pieces in the same lane both finishing via the barrier-breaking double's
    // other half produce numerically identical resultingTrackPosition/resultingCorridorPosition
    // values purely because they share a lane, not because they'd share a square - this filter was
    // reading that coincidence as "recreating the barrier" and silently dropping the second pawn's
    // own genuine FinishMove. A Finished piece can never be part of a barrier at all (see
    // ownCorridorBarrierPosition's own doc comment - the final slot is deliberately excluded from
    // barrier counting), so no FinishMove can ever actually recreate one; excluding this move kind
    // outright is correct, not just a narrow patch for the double-1 case.
    if (this.brokenBarrierThisRoll) {
      const broken = this.brokenBarrierThisRoll
      options = options.filter((m) => {
        const sameOrigin =
          broken.kind === 'track'
            ? m.piece.state === 'OnTrack' && m.piece.trackPosition === broken.position
            : m.piece.state === 'InHomeCorridor' && m.piece.corridorPosition === broken.position
        return !(m.kind !== 'FinishMove' && sameOrigin && m.resultingTrackPosition === broken.resultingTrackPosition && m.resultingCorridorPosition === broken.resultingCorridorPosition)
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
    //
    // Scoped to a *single die's own* value, not the sum: PC3's own text draws this exact line -
    // "if the roll of a die or the sum of both dice lands on [an opponent], that pawn is eliminated"
    // (capturing via the sum is allowed and still rewarded) vs. "if the number rolled on *one of the
    // dice* matches [an opponent's] square, you can only move forward if you capture" (only a
    // single-die-reachable capture is mandatory) - independently reinforced by the corrected PDF's
    // own "CAPTURE OR JUMP" page ("if you have no other legal move *using that die*, you must
    // capture"). A capture only reachable via the sum stays a genuine option, never a forced one.
    //
    // Reported directly, with the client's own corrected rules doc ("eliminar al Parki con un peón
    // NO ES OBLIGATORIO" - eliminating the Parki with a pawn is NOT mandatory): unlike an ordinary
    // pawn capture, landing a common piece on the enemy Parki during its own capture window (PK6/
    // PK8) is a free choice, not a forced one - confirmed directly against the reference
    // implementation's own two, deliberately different tutorial messages for the two cases:
    // ordinary capture's own activarFichasMovibles() message reads "debes comer obligadamente" (you
    // MUST capture, mandatorily), while the Parki-capture-during-a-barrier-lock message reads
    // "PUEDES mover fichas... si tienes posibilidad de comer al parkiller" (you CAN move pieces...
    // if you have the chance to eat the Parkiller) - "puedes", not "debes". Passing false here
    // (instead of this.parkillerCapturableThisRoll) keeps a Parki-eliminating move fully offered
    // alongside this piece's other options rather than forcing it out as the only choice - it still
    // resolves as a real elimination if the player actually picks it (applyMove's own
    // allowParkillerCapture handles that separately, untouched by this).
    const optionsByPiece = new Map<Piece, MoveOption[]>()
    for (const move of options) {
      const list = optionsByPiece.get(move.piece)
      if (list) list.push(move)
      else optionsByPiece.set(move.piece, [move])
    }
    options = [...optionsByPiece.values()].flatMap((pieceOptions) => {
      const capturing = pieceOptions.filter((m) => m.diceSource !== 'sum' && wouldCapture(this.board, m, this.players, false))
      return capturing.length > 0 ? capturing : pieceOptions
    })

    // See doubleExitPairable's own doc comment. Only ever true right after the first exit of a
    // double exit-roll, with the other die still unspent; every option left is then one more exit
    // (the exit lock above already restricted it to that). When the entry square is already full
    // (an own pawn there, or a capture owing a reward first) no exit is offered here and this
    // simply doesn't apply.
    const playSecondExitNow = this.doubleExitPairable && state.dieAUsed !== state.dieBUsed && options.length > 0 && options.every((m) => m.kind === 'ExitYard')
    this.doubleExitPairable = false
    if (playSecondExitNow) {
      this.playMove(options[0], true)
      return
    }

    this.pendingMoves = options

    if (this.pendingMoves.length === 0) {
      this.moveNotPossible.emit('none')
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
    return this.playMove(move, false)
  }

  // Everything submitMove() does once the move itself is known. `simultaneousWithPrevious` marks
  // the exit offerMoves() plays on the player's behalf right after the first one (see
  // doubleExitPairable) - only the animation event cares.
  private playMove(move: MoveOption, simultaneousWithPrevious: boolean): MoveResult {
    const chosenPiece = move.piece
    const isRewardMove = move.diceSource === 'reward'
    const before = snapshotPiece(chosenPiece)

    const isDoubleRoll = this.diceState ? this.diceState.dieA === this.diceState.dieB : false
    // Read before applyMove() - see doubleExitPairable's own doc comment for why any other piece
    // (pawn or Parkiller, own or foreign) already on the exit square rules out playing both exits
    // together.
    const exitSquareWasOccupied =
      move.kind === 'ExitYard' &&
      this.players.some(
        (p) =>
          p.pieces.some((piece) => piece.state === 'OnTrack' && piece.trackPosition === move.resultingTrackPosition) ||
          (isParkillerOnTrack(p.parkiller) && p.parkiller.trackPosition === move.resultingTrackPosition),
      )
    const result = applyMove(
      this.board,
      move,
      this.players,
      this.settings,
      this.parkillerCapturableThisRoll,
      this.nextArrivalSequence++,
      isDoubleRoll,
      this.openedEntryPairThisRoll,
      this.piecesMovedThisRoll,
    )
    // See piecesMovedThisRoll's own doc comment - recorded *after* applyMove above (which needed to
    // see this piece's own prior-moves-this-roll status as it stood *before* this move, not
    // including this one), so a further move on this same piece later in the same roll (the
    // double's other identical die) correctly sees it as already-moved.
    this.piecesMovedThisRoll.add(chosenPiece)
    // Client's own "Special Situations" guide: this exit just resolved a mixed pawn+Parkiller pair
    // on the entry square by eliminating the pawn (case C/B in applyMove's own comments), or one of
    // two foreign Parkis paired there (case E) - if a Parkiller is still standing there either way,
    // track the square so a further own pawn joining it later this same roll (the double's other
    // exit) eliminates it too, instead of applyMove's ordinary "bounces the joining pawn home"
    // resolution for an unrelated, genuinely pre-existing pairing. Cleared at the start of every
    // roll (requestRoll), same as brokenBarrierThisRoll.
    this.openedEntryPairThisRoll =
      move.kind === 'ExitYard' &&
      (result.capturedPiece || result.capturedParkillerColor) &&
      this.players.some(
        (p) => p.color !== chosenPiece.color && isParkillerOnTrack(p.parkiller) && p.parkiller.trackPosition === move.resultingTrackPosition,
      )
        ? move.resultingTrackPosition
        : this.openedEntryPairThisRoll
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
    // PK6/PK8: reported directly ("Doble 6 del Parki: no lo eliminó" - double 6, it didn't
    // eliminate the Parki), reproduced precisely: a double gives two separate single-die
    // opportunities to eliminate the Parki (the rulebook's own "rolling the exact double... moves
    // the pawn [that value] spaces" names no restriction to whichever one is submitted first).
    // This used to unconditionally clear the window after ANY move this roll - the very first
    // move, even an unrelated one, or even a reward move chained off a capture - closing it before
    // the double's OTHER die ever got a chance to land on the Parki. usesSingleDie (below, at the
    // actual capture check) already keeps a reward move from ever counting on its own; nothing else
    // needs to force this window shut mid-roll - the next roll's own resolveParkillerMove already
    // resets it fresh (dieA === dieB, or false for a non-double) before offerMoves() ever runs
    // again, so simply not clearing it here lets both of this roll's own dice keep their real
    // chance at it.
    this.lastMovedPiece = chosenPiece
    this.pendingMoves = null
    this.doubleExitPairable =
      !isRewardMove &&
      !simultaneousWithPrevious &&
      move.kind === 'ExitYard' &&
      !exitSquareWasOccupied &&
      isDoubleRoll &&
      move.amount === this.settings.exitRoll &&
      chosenPiece.state === 'OnTrack' &&
      !result.capturedPiece &&
      !result.capturedParkillerColor &&
      !result.eliminatedByParkiller

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
      ...(simultaneousWithPrevious ? { simultaneousWithPrevious: true } : {}),
    })

    if (hasWon(this.currentPlayer)) {
      this.gameWon.emit(this.currentPlayer)
      return result
    }

    // This move claimed (part of) an active reward grant - if it only took the smaller, split-off
    // amount (10 out of a capture's own 20), the rest is still owed - see PendingReward's own
    // doc comment for why this no longer excludes the piece that just moved. Checked before
    // queueing any *new* reward below, so a capture-during-a-reward-chain still stacks on top of
    // this remainder rather than ahead of it (pendingRewardQueue is drained front-to-back).
    if (isRewardMove && this.currentRewardGrant) {
      const grant = this.currentRewardGrant
      this.currentRewardGrant = null
      if (move.amount < grant.amount) {
        this.pendingRewardQueue.push({ reason: grant.reason, amount: grant.amount - move.amount })
      }
    }

    // PC 3/PC 4: capturing or finishing earns a reward, and PC 6.2 places collecting it ahead of
    // any dice still unspent. A move landing on this same reward can itself capture again, in
    // which case PC 5 adds the new reward on top rather than replacing it. PK6 rewards eliminating
    // an opposing Parkiller the same size as a regular capture (REWARD_UNIT*2), but under its own
    // 'parkillerCapture' reason (see RewardReason's own doc comment) rather than plain 'capture' -
    // checked first since a single move can, per applyMove's own capturedPiece/capturedParkillerColor
    // interaction (a pawn+foreign-Parkiller pair, a different color from the Parkiller, can have
    // this same move eliminate both the pawn and, via PK6's single-die window, the Parkiller too),
    // set both at once - the bigger, Parkiller-elimination event is the one worth surfacing.
    if (result.capturedParkillerColor) this.pendingRewardQueue.push({ reason: 'parkillerCapture', amount: REWARD_UNIT * 2 })
    else if (result.capturedPiece) this.pendingRewardQueue.push({ reason: 'capture', amount: REWARD_UNIT * 2 })
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
  // roll happened to be a double. This used to always exclude a barrier piece from a reward move on
  // the theory that "roll a double" and "an opposing Parki" were the rulebook's own *only* ways to
  // open a barrier, so a bonus/reward move (spending accumulated squares, not a die's own face
  // value) could never be one of them - since corrected directly by the client, the same way as
  // offerMoves()'s own dieA/dieB/sum moves (see pieceIsInOwnBarrier's own doc comment): a barrier
  // only ever blocks *other* pieces from landing on or passing through it, never its own occupants
  // from leaving voluntarily, on any kind of move, reward included. Reported directly again once
  // this specific case (a capture's own reward, with every eligible piece sitting in a barrier)
  // came up: excluding them here still forfeited the whole reward and handed the turn to the next
  // player, "el tema de las barreras sigue sin funcionar" - the barrier voluntary-movement fix
  // never actually reached this path.
  //
  // A splittable grant (a fresh capture's own 20 - see PendingReward's own comment for why this
  // isn't forced down one fixed path) offers *both* amounts together: every piece that can move
  // the full grant amount in one go, and every piece that can move exactly REWARD_UNIT instead -
  // same amount-keyed-per-piece pattern offerMoves() already uses for dieA/dieB/sum, so a piece
  // reachable both ways keeps both options rather than collapsing to one. Picking the smaller
  // amount leaves the rest queued (handled back in submitMove, right after this move applies);
  // picking the full amount resolves the whole grant in this one move.
  private offerReward(grant: PendingReward) {
    // 'parkillerCapture' is the same size/split-eligible reward a plain 'capture' is (see
    // RewardReason's own doc comment) - only 'finish' (a flat, non-splittable REWARD_UNIT) is
    // ever excluded here.
    const canSplit = grant.reason !== 'finish' && grant.amount > REWARD_UNIT
    const fullMoves = getValidMoves(this.board, this.currentPlayer, this.players, grant.amount, this.settings, 'reward')
    const splitMoves = canSplit ? getValidMoves(this.board, this.currentPlayer, this.players, REWARD_UNIT, this.settings, 'reward') : []

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
