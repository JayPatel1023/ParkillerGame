import type { BoardData } from '../board/boardData'
import type { PieceColor } from '../pieceColor'
import { isParkillerOnTrack, wouldCapture } from '../rules/parchisRules'
import type { MoveOption, MoveResult } from '../rules/moveOption'
import type { Piece } from '../pieces/piece'
import type { DiceRoll } from './turnManager'
import type { Listenable } from './turnManagerLike'
import type { PlayerState } from './playerState'

// Purely for feel - an instant bot turn would read as broken/too fast rather than "an opponent
// playing quickly". Reported directly ("봇이 게임하는게 좀 빠르다... 사람의 속도처럼 하되 너무느리거나
// 시간간격을 너무 오래두지는말라" - the bot plays a bit fast, make it feel human-paced but not too
// slow either): 700ms (originally just mirroring the human roll-spin delay in useTurnManager's
// rollDice(), a different animation with its own separate timing) wasn't long enough to read as an
// opponent actually deciding - a roll lands and the next action fires again almost immediately,
// which also made it hard to visually confirm each step was legitimate rather than skipped. First
// bump was to 1100ms.
//
// Reported directly again, this time from the client and visibly frustrated ("no da tiempo a ver
// qué se ha movido" - it doesn't give time to see what moved; "사람이 게임하는 속도와 동일하게" -
// make it the same as a human's own playing pace): 1100ms still wasn't enough to actually register
// what a bot's own move just did before the next one started. A real human turn - physically
// rolling two dice, reading the result, deciding which piece to move - realistically takes several
// seconds, not ~1 second; the previous bump was too timid relative to that actual target. Bumped
// again, more assertively this time, to a pace that reads as "an opponent genuinely looking at the
// board and deciding" rather than merely "not instant" - still short of dragging, per that same
// report's own "don't make it too slow either" caveat.
//
// Reported a THIRD time, still too fast ("여전히너무빨리 움직이고잇따"), even after the 1100->1800
// bump above shipped. Verified this class's own scheduling math by hand: every discrete bot action
// (roll, each move) already waits at least the full think-delay from when it becomes available, not
// merely from when the previous action was *submitted* - so two consecutive timid bumps clearly
// weren't landing as "clearly deliberate" to an actual human watching. Breaking that cycle with one
// decisive jump instead of another small increment - long enough that a turn unmistakably reads as
// "someone is taking their turn," not iterating a smaller number again.
//
// Reported a FOURTH time, now the other direction ("너무뜨다... 조금만 대단히 조금만 빠르게해달라" -
// too slow, make it just a little, just a very little, faster) - right after this file's own
// Parkiller-hop/first-move sequencing bug fix started actually enforcing waits it had previously
// been skipping in some cases (see onMoveChoicesReady's own comment), which on top of the already
// long 3000ms pushed a full turn's pace past "deliberate" into "dragging." Explicitly a *small*
// trim per that report's own wording, not another swing back to an earlier value.
const BOT_THINK_DELAY_MS = 2400

// Reported directly: a bot's pieces sometimes hopped at a normal, readable pace and sometimes
// moved "at light speed" - hard to tell a bug from a feature. Root cause: this class used to wait
// a flat BOT_THINK_DELAY_MS before every action, with no regard for how long the *previous*
// action's own animation actually takes to play out on screen (a roll's dice-spin, the Parkiller's
// own hop, or a piece's hop - all real wall-clock time in the scene layer, while this class's own
// game-state calls resolve instantly). A short move left plenty of margin; a long one (a reward
// move can be up to 20 squares) or a big black-die roll did not, so the *next* scheduled action
// fired while the current hop/spin was still playing, and BoardScene's own hop system resets a
// piece straight to its already-resolved end position instead of finishing the animation in
// progress (see BoardScene.tsx's own comment on `animatingHopData` for that exact behavior) -
// which reads as an instant jump, not a bug in the strict sense, but exactly the "light speed"
// symptom reported. `busyUntilMs` tracks a running "don't act again before this real time" bound,
// extended by every action this class takes, so a slow-playing animation is never cut short by
// the next one - this class has no direct access to the scene layer's own timing constants
// (gameFlow/ and scene/ are peers in this project's own layering, neither depending on the
// other), so the values below are duplicated from there and must be kept in sync: DICE_SPIN_MS
// matches useTurnManager.ts's own constant of the same name, HOP_DURATION_MS matches
// PieceMesh.tsx's HOP_DURATION (in seconds, *1000 here).
const DICE_SPIN_MS = 2000
// Kept in sync with PieceMesh.tsx's own HOP_DURATION (0.48s, *1000 here) - reported directly
// ("말속도가 너무빠르므로 느리게 해달라" - the piece speed is too fast, slow it down): a slower hop
// there with this constant left stale would under-count real animation time, reopening the exact
// "light speed" bug this file's own busyUntilMs tracking was built to prevent (see this constant's
// neighboring comment above).
const HOP_DURATION_MS = 480

// Kept in sync with piecePosition.ts's own CAPTURE_RETURN_HOPS (3) - a captured pawn (PC3/PC4,
// BoardScene.tsx's own captureFlights) or a self-eliminated mover (PK5, BoardScene.tsx's own
// animatingHopData eliminatedByParkillerAt branch) plays a few extra "flung home" bounce hops
// beyond the plain amount-hop walk this class otherwise budgets for below. For a *bot's own* move,
// only the self-elimination case actually needs this constant's own explicit accounting (see
// extraBounceMs' own doc comment for why an ordinary captured pawn's bounce is already covered
// elsewhere there, via CELEBRATION_HOLD_MS) - missing it for self-elimination was the root cause of
// a real reported bug, found by tracing this class's own busyUntilMs math against the scene layer's
// actual playback time: whenever this bounce was still genuinely playing but busyUntilMs had
// already elapsed (having never budgeted for it), the *next* turn's roll fired mid-bounce - and
// BoardScene/PieceMesh's shared diceSettledAt gate (see useTurnManager.ts's own doc comment,
// re-armed by that new roll) snapped the still-animating piece straight back to its own hop's
// starting square until the new roll's reveal passed, then resumed exactly where it left off. That
// reads as "the pawn that just moved reverts to its original position for a few seconds while the
// next player's dice are rolling, then catches up".
//
// Reported again, directly, after that fix (and RemoteTurnManager.ts's matching online one)
// shipped: the *human*-move call site below (session.moveApplied.on) never had any equivalent
// margin at all for an ordinary capture - unlike every bot call site, it adds no CELEBRATION_HOLD_MS
// (that's a bot-pacing-only allowance), so a human capturing with a small amount left the very next
// bot free to roll while the captured pawn's own bounce was still playing. That listener now also
// checks result.capturedPiece, not just result.eliminatedByParkiller - see its own doc comment.
const CAPTURE_RETURN_HOPS = 3

// Requested directly ("EL BOT TIENE QUE HACER ETAPAS EN SUS MOVIMIENTOS PARA QUE QUEDEN BIEN
// MARCADOS... LA ENTRADA DE UN PEON EN LA META, LA ELIMINACION DE UN PEON, LA ELIMINACION DE UN
// PARKI.... DEBEN SER FESTEJADAS Y CADA MOVIMIENTO SEPARADO POR UNOS SEGUNDOS UNOS DE OTROS. PARA
// QUE SE VEAN Y SE PUEDAN CONTAR" - the bot has to make clearly-marked stages in its moves; a pawn
// reaching home, a pawn elimination, a Parki elimination should each be celebrated, with a few
// seconds between one movement and the next, so they can be seen and counted): busyUntilMs already
// covers the hop's own real animation time (amount*hopDurationMs) so the *next* action can't cut a
// plain move's hop short, but a capture, a Parki elimination, or a finish additionally triggers its
// own separate celebration - RewardBurst/RewardToast/EliminationToast/FinishCelebrationEffect,
// GameBoardScreen.tsx - with its own hold time this class has no visibility into at all (that's
// presentation-layer state, read from useTurnManager's own events, not this session's narrow
// BotDrivableSession interface). Without an extra allowance here, the bot's own next roll or move
// could fire while that celebration was still only partway through playing. Long enough to read as
// "a moment to look," short of the human-turn-specific TURN_CHANGE_HOLD_MS below (this is about the
// bot's own pace staying legible, not matching a human's own much longer reveal window - the
// client's own separate "al bot dejale 2 o 3 segundos nada mas" already drew that same line for
// reveals in general).
const CELEBRATION_HOLD_MS = 2000

// Matches useTurnManager.ts's own constant of the same name - see its own doc comment for why this
// is 3000, not the 10000 first tried here (10 seconds was never something Carlos actually asked
// for - his own consistently repeated number is 2-3 seconds). Applied here so this class's own
// scheduling of the next bot's roll never gets ahead of useTurnManager.ts's own reveal for that
// same handoff - a bot rolling before that hook's own hold clears would desync the dice/board from
// what the screen still shows.
const TURN_CHANGE_HOLD_MS = 3000

// Same minimal pub-sub as turnManager.ts's own EventEmitter (not exported from there, so
// duplicated here rather than reaching into a peer module for an implementation detail - see this
// file's own DICE_SPIN_MS/HOP_DURATION_MS above for the same "small, deliberate duplication over a
// cross-module dependency" call).
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

/** The narrow surface BotController actually needs to drive a game - satisfied structurally by
 * both HostTurnManagerBridge (online, see its own rollForBot()/submitMoveForBot() doc comments -
 * bots have no connected actor, so they bypass that class's own actor-ownership validation) and
 * LocalBotSession (local vs-bots play, src/gameFlow/localGameSession.ts - a bot there has no
 * "ownership" concept to bypass at all, since it's one shared device; rollForBot/submitMoveForBot
 * there are just plain requestRoll/submitMove under these two names). Moved here from src/online/
 * (where this class originally lived, online-only) so src/core/ - which local play's own
 * localGameSession.ts belongs to - doesn't have to depend on src/online/, a strictly higher
 * layer in this project's own architecture. */
export interface BotDrivableSession {
  readonly currentPlayer: PlayerState
  /** Every player in this game, not just currentPlayer - needed to check an opposing color's own
   * Parkiller position (see wouldWalkIntoUnprotectedParki). */
  readonly players: readonly PlayerState[]
  /** Needed for safeTrackIndices - see wouldWalkIntoUnprotectedParki. */
  readonly board: BoardData
  readonly turnStarted: Listenable<PlayerState>
  readonly diceRolled: Listenable<DiceRoll>
  readonly moveChoicesReady: Listenable<MoveOption[]>
  /** Fires for *every* applied move, this bot's own or any other player's (a real TurnManager's
   * own moveApplied, forwarded unchanged by both LocalBotSession and HostTurnManagerBridge) - see
   * this class's own constructor for why a bot needs to see a non-bot player's moves too, not just
   * its own. */
  readonly moveApplied: Listenable<MoveResult>
  rollForBot(): void
  submitMoveForBot(piece: Piece, amount?: number): MoveResult | null
}

/**
 * Drives every bot-assigned color in a game - bots act directly on the same authoritative session
 * object the real UI binds to, via its own rollForBot()/submitMoveForBot() (see BotDrivableSession's
 * own doc comment for why those exist as a separate pair from requestRoll()/submitMove()).
 *
 * Move selection for this pass is deliberately simple - the first legal option, whatever it is.
 * A real heuristic (prefer captures/finishes) is Phase 2 polish, not required to prove the
 * architecture or to make bots functional.
 */
export class BotController {
  private readonly session: BotDrivableSession
  private readonly botColors: Set<PieceColor>
  private readonly thinkDelayMs: number
  private readonly hopDurationMs: number
  private readonly diceSpinMs: number
  private readonly turnChangeHoldMs: number
  private readonly unsubscribers: Array<() => void>
  private readonly pendingTimeouts = new Map<ReturnType<typeof setTimeout>, () => void>()
  // Real time (Date.now()-based, so it advances correctly under vitest's fake timers too) before
  // which this class won't schedule its *next* action - see this file's own top comment.
  private busyUntilMs = 0
  // Requested directly ("로컬 게임에는 Pause 기능을 넣어라" - add a Pause feature to local games):
  // pause() cancels whatever this class currently has scheduled (a bot's own think-delay before
  // rolling, or before submitting its already-decided move) without losing track of *what* that
  // action was - each cancelled callback moves here instead of just being dropped, so resume() can
  // put it back on the clock with a fresh think-delay rather than the bot silently never acting
  // again for the rest of the game. schedule() itself refuses to arm a new timeout at all while
  // paused, straight into this same list, so an event that fires *during* a pause (shouldn't
  // normally happen, since GameBoardScreen also blocks human input while paused, but session state
  // isn't itself frozen) can't sneak a running timer past it either.
  private paused = false
  private frozenActions: Array<() => void> = []
  // See TURN_CHANGE_HOLD_MS's own doc comment - tracks whichever color last had a turn (regardless
  // of bot/human), so onTurnStarted can tell a genuine handoff to a *different* player from a
  // double's own bonus turn continuing for the same one. Null only before the very first
  // turnStarted this instance ever sees, so that first turn is never mistaken for a handoff.
  private lastTurnColor: PieceColor | null = null
  // Reported directly ("봇이게임할때 말을 이동할차례가되여서 이동시킬때에도 자기 차례를 알리는 효과를
  // 넣어달라" - add the same turn-announcing effect for bot moves too): a human's own choosable
  // piece gets a whole flashy ring/glow/beam indicator (PieceMesh.tsx) the instant it becomes
  // selectable; a bot's move used to just start hopping with no equivalent cue at all, since that
  // indicator is driven by pendingMoves, which the UI empties outright during a bot's own turn
  // (GameBoardScreen's own visiblePendingMoves, gated on isMyTurn). Emits the specific piece this
  // class has just decided on, for the UI to run that exact same indicator against - fired as soon
  // as the decision is made (the *start* of this action's own think-delay), so the highlight has
  // time to actually read before the piece starts moving, not just flash for an instant right
  // before the hop. Emits null once the move is actually submitted, handing off to the hop
  // animation itself as the next visual cue.
  readonly pieceHighlighted = new EventEmitter<Piece | null>()
  constructor(
    session: BotDrivableSession,
    botColors: Set<PieceColor>,
    thinkDelayMs = BOT_THINK_DELAY_MS,
    hopDurationMs = HOP_DURATION_MS,
    diceSpinMs = DICE_SPIN_MS,
    turnChangeHoldMs = TURN_CHANGE_HOLD_MS,
  ) {
    this.session = session
    this.botColors = botColors
    this.thinkDelayMs = thinkDelayMs
    this.hopDurationMs = hopDurationMs
    this.turnChangeHoldMs = turnChangeHoldMs
    this.diceSpinMs = diceSpinMs
    this.unsubscribers = [
      session.turnStarted.on((player) => this.onTurnStarted(player.color)),
      // Reported directly ("parki말이 다움직인다음 일반 pawn이 움직이게 해달라" - let the Parkiller
      // finish moving, *then* let the regular pawn move): requestRoll() (turnManager.ts) emits
      // diceRolled, then resolves+emits parkillerMoved, then emits moveChoicesReady, all
      // synchronously in that order within one call - but this class used to only extend
      // busyUntilMs for the Parkiller's own hop *after* rollForBot() returned, back in
      // onTurnStarted's own callback below. Since moveChoicesReady (and this class's own
      // onMoveChoicesReady, which schedules the first pawn move) fires *before* rollForBot()
      // returns, that scheduling always ran against the *previous* action's busy window, not this
      // roll's own Parkiller-hop budget - so the pawn's own hop could get scheduled before the
      // Parkiller's own hop had actually finished playing, if the think-delay ever happened to be
      // shorter than the roll+hop time (currently masked by BOT_THINK_DELAY_MS comfortably
      // exceeding the worst case, but not a real guarantee - see this file's own top comment on
      // that constant's history of being retuned). Moving the busy-window extension into this
      // diceRolled subscriber itself - which fires synchronously, strictly before
      // moveChoicesReady, every single roll - makes the ordering correct unconditionally, not just
      // by the current constants' own coincidence.
      session.diceRolled.on((roll) => {
        this.markBusy(this.diceSpinMs + roll.blackDie * this.hopDurationMs)
      }),
      // Reported directly ("El bot debe esperar a que terminen de moverse los peones antes de
      // lanzar los dados del siguiente jugador" - the bot must wait for the pawns to finish moving
      // before rolling the next player's dice): onMoveChoicesReady's own markBusy call below only
      // ever runs for *this bot's own* move (gated on botColors, right before submitMoveForBot) -
      // a human player's move never touched busyUntilMs at all, so the very next bot's turn could
      // start rolling/deciding while a human's own pawn was still mid-hop on screen. This fires for
      // every applied move regardless of who made it; skipping a bot's own color here avoids
      // double-counting against the pre-emptive call already covering it (see that call's own
      // comment on why it has to run *before* submitMoveForBot, not after).
      session.moveApplied.on((result) => {
        if (this.botColors.has(result.movedPiece.color)) return
        // A human move that self-eliminates (PK5) plays the same extra bounce-home hops a bot's
        // own move does - read directly off the already-resolved MoveResult instead of predicted
        // from a MoveOption, since this is the only call site for a *human's* move (a bot's own is
        // covered where it's chosen, above/below, via extraBounceMs(move)).
        //
        // Also now covers an ORDINARY capture (result.capturedPiece set, no self-elimination) -
        // found by tracing a real reported repeat of this exact symptom after the self-elimination
        // fix above had already shipped ("Sigue volviendo atrás antes de que lance el jugador
        // siguiente" - it keeps going back before the next player rolls). extraBounceMs(move) (this
        // file's own helper, below) deliberately leaves ordinary captures uncovered because every
        // *bot* call site that can trigger one also separately adds CELEBRATION_HOLD_MS (2000ms),
        // comfortably exceeding this exact bounce's real 3*hopDurationMs (~1440ms) - see that
        // helper's own doc comment. But THIS listener is for a *human's* move, and never added
        // CELEBRATION_HOLD_MS (or anything else) for an ordinary capture at all - a human capturing
        // with a small amount (1-3 squares, i.e. under ~1440ms of its own hop) left the very next
        // bot free to roll while the captured pawn's own separate "flung home" bounce
        // (BoardScene.tsx's own captureFlights, spawned only once this move's own hop animation
        // clears - it doesn't gate or delay anything else about turn flow on its own) was still
        // genuinely playing, re-arming the shared diceSettledAt gate mid-bounce exactly like the
        // self-elimination case above.
        const extraBounceMs = result.eliminatedByParkiller || result.capturedPiece ? CAPTURE_RETURN_HOPS * this.hopDurationMs : 0
        this.markBusy(result.amount * this.hopDurationMs + extraBounceMs)
      }),
      session.moveChoicesReady.on((moves) => this.onMoveChoicesReady(moves)),
    ]
  }

  private onTurnStarted(color: PieceColor): void {
    // See TURN_CHANGE_HOLD_MS's own doc comment - a genuine handoff to a different player (never a
    // double's own bonus turn continuing for the same one) holds this bot back the same extra
    // stretch useTurnManager.ts holds its own reveal back for, so neither side gets ahead of the
    // other.
    const isHandoffToNewPlayer = this.lastTurnColor !== null && this.lastTurnColor !== color
    this.lastTurnColor = color
    if (!this.botColors.has(color)) return
    const extraHoldMs = isHandoffToNewPlayer ? this.turnChangeHoldMs : 0
    this.scheduleRespectingBusy(this.thinkDelayMs + extraHoldMs, () => {
      if (this.session.currentPlayer.color !== color) return // stale - state moved on before this fired
      this.session.rollForBot()
    })
  }

  private onMoveChoicesReady(moves: MoveOption[]): void {
    if (moves.length === 0) return
    const color = this.session.currentPlayer.color
    if (!this.botColors.has(color)) return
    // Requested directly ("sale 5 + cualquier otro numero....MUEVE PRIMERO EL CINCO PARA SALIR DEL
    // REFUGIO (orden de prioridades) PRIMERO SALIR" - when a 5 comes up alongside any other number,
    // move the 5 first to exit the yard - priority order, exit first): PC2.1 already makes a die
    // matching the exit roll unusable for anything *but* the exit when a yard piece can use it (see
    // offerMoves' own applyObligations), so this was never about *whether* the exit eventually
    // happens - it always does. It's the *order* the bot spends multiple still-unused dice in when
    // more than one is independently legal this roll: nothing below this point steers toward
    // resolving an available exit before some unrelated piece's own move on a different die, so a
    // bigger non-exit amount could win the largestAmount tie-break further down and get submitted
    // first, leaving the exit for later in the same roll instead of leading with it. Skips the rest
    // of this method entirely when one's available - an exit is never risky (PC2.2's own entry
    // square is always a safe square) and never something to weigh against forming a barrier,
    // Parkiller exposure, or anything else this function otherwise guards against.
    const exitMoves = moves.filter((m) => m.kind === 'ExitYard')
    if (exitMoves.length > 0) {
      const chosen = exitMoves[0]
      this.pieceHighlighted.emit(chosen.piece)
      this.scheduleRespectingBusy(this.thinkDelayMs, () => {
        if (this.session.currentPlayer.color !== color) {
          this.pieceHighlighted.emit(null)
          return
        }
        this.markBusy(chosen.amount * this.hopDurationMs + this.extraBounceMs(chosen))
        this.pieceHighlighted.emit(null)
        this.session.submitMoveForBot(chosen.piece, chosen.amount)
      })
      return
    }
    // Reported directly, client visibly frustrated: a color could get stuck for many consecutive
    // turns after a bot carelessly walked itself into forming its own barrier with no strategic
    // reason to. Once formed, a barrier's own two pieces are locked in place until a double breaks
    // it open (rules.pdf's own "OPENING A BARRIER" page, PK9.1) - correct and already verified
    // against the client's own rulebook, but a naive "always pick moves[0]" bot has no notion of
    // *avoiding* that self-inflicted wait when an equally legal alternative exists. Reproduced
    // directly: a stress test found streaks of up to 16 consecutive wasted turns for a single
    // color once it got stuck this way. The rule itself doesn't need to change; a bot that steers
    // away from an avoidable barrier fixes the actual experience instead. Only steers away from
    // *forming* a new one - every move in `moves` already satisfies every other obligation
    // (mandatory capture, exit lock, an existing barrier's own break requirement) before this ever
    // runs, so picking a different entry from this same list can't dodge anything mandatory - and
    // this still falls back to the plain first option if avoiding a barrier isn't actually possible
    // this roll.
    const nonBarrierMoves = moves.filter((m) => !this.wouldFormOwnBarrier(m))
    // Reported directly ("El BOT tenía dos peones para mover y en vez de mover uno y luego otro,
    // siguió con el que iba a caer en la casilla del parki y se suicidó" - the bot had two pawns
    // to move and instead of moving one then the other, it kept going with the one that was going
    // to land on the Parki's square and it committed suicide): landing on an unprotected opposing
    // Parkiller (PK5: sent straight home, no reward) when an equally legal alternative move exists
    // is the same class of avoidable self-inflicted mistake as forming an own barrier above - just
    // costlier (the whole piece's progress lost, not just a temporary wait). Layered on top of the
    // barrier-avoidance above, not instead of it: prefers a move that dodges both when one exists,
    // falls back to whichever of the two sets is non-empty otherwise, same graceful degradation the
    // barrier check alone already used.
    const preferredMoves = nonBarrierMoves.filter((m) => !this.wouldWalkIntoUnprotectedParki(m))
    const safeMoves = preferredMoves.length > 0 ? preferredMoves : nonBarrierMoves
    // Requested directly ("Debía haber movido incluso todas las casillas con el peón más alejado y
    // quedar a más de 6 casillas del Parki" - it should have moved even all the squares with the
    // farthest pawn and ended up more than 6 squares from the Parki): the black die is 1-6, so a
    // piece left within that range of an opposing Parkiller, on an unprotected square, could be
    // reached on that Parkiller's very *next* roll - not yet an actual elimination this roll
    // (wouldWalkIntoUnprotectedParki, above, already dodges landing directly on one), but leaving a
    // piece exposed to next roll's danger when an equally legal move would clear it entirely is the
    // same avoidable class of risk, one step earlier. Same layering/fallback pattern as the two
    // preferences above it.
    // Reported directly, with a screenshot ("6 + 1 DEBÍA HABER ELIMININADO AL QUE TENÍA A TIRO DE 1
    // EN VEZ DE MOVER 7 CON OTRO PEÓN" - it should have eliminated the one it had lined up with the
    // 1, instead of moving 7 with another pawn): reproduced directly - a capturing move that also
    // happens to leave the *capturing* piece exposed afterward got filtered out here exactly like
    // any other exposed-but-not-capturing move, so as long as some other, unrelated piece had a
    // genuinely safe move available, that safe-but-idle move won by default and the capture was
    // never even offered to the capturingMoves preference further down - it only ever saw whatever
    // survived this filter. keepsProtectedPiecesSheltered (below) already carries this exact "unless
    // it captures" exception for giving up a protected square; missing it here for ordinary
    // Parkiller-exposure meant a real material gain (sending an opponent's pawn all the way home)
    // was being silently traded away for a comparatively minor, speculative future risk to the
    // capturing piece itself.
    const unexposedToParkillerMoves = safeMoves.filter((m) => !this.wouldLeavePieceExposedToParkiller(m) || wouldCapture(this.session.board, m, this.session.players, false))
    const safeFromParkiller = unexposedToParkillerMoves.length > 0 ? unexposedToParkillerMoves : safeMoves
    // Reported directly ("El bot en vez de mover dos peones diferentes, con la suma de los dados
    // 'se suicida el que va en cabeza'" - the bot, instead of moving two different pawns, suicides
    // its lead pawn with the sum of the dice): every exposure check above this line only ever
    // looked at danger from the opposing *Parkiller* - there was no equivalent check at all for an
    // ordinary opposing pawn's own one-roll reach, so a sum-move landing the lead pawn within a
    // normal opponent's capture range sailed through every filter untouched, then won the final
    // largestAmount tiebreak below purely for covering more ground, over a safer two-pawn split
    // that used each die on a different piece. Same layering/fallback pattern as the Parkiller
    // check right above - only actually prefers dodging this once dodging the Parkiller is also
    // satisfied (or impossible), never the other way around.
    // See unexposedToParkillerMoves' own comment just above - same "unless it captures" exception,
    // for the exact same reason and the exact same reported bug (that report's own board state
    // specifically exposed the capturing piece to an ordinary pawn, not the Parkiller).
    const unexposedMoves = safeFromParkiller.filter((m) => !this.wouldLeavePieceExposedToPawn(m) || wouldCapture(this.session.board, m, this.session.players, false))
    const riskAwareMoves = unexposedMoves.length > 0 ? unexposedMoves : safeFromParkiller
    // Requested directly ("si algún peón del bot está en una casilla protegida no debería
    // arriesgarse a ser eliminado salvo para eliminar a otro peón. Es mejor que se mueva otro
    // peón y nunca suicidarse avanzando sin contar contra un parki" - if a bot's pawn is on a
    // protected square, it shouldn't risk elimination except to capture; better to move a
    // different pawn instead, never suicide by advancing without accounting for a Parki): the two
    // exposure checks just above only ever look at where a move *lands* - a piece already
    // sheltered on a protected square gives up that guaranteed safety the moment it leaves, even
    // to a destination neither check flags as risky. Among otherwise equally-safe options, prefer
    // leaving that piece exactly where it is and moving a different one instead - unless this
    // move itself captures, worth trading the shelter for.
    const keepsProtectedPiecesSheltered = riskAwareMoves.filter((m) => {
      const leavesProtectedSquare = m.piece.state === 'OnTrack' && this.session.board.safeTrackIndices.has(m.piece.trackPosition)
      if (!leavesProtectedSquare) return true
      return wouldCapture(this.session.board, m, this.session.players, false)
    })
    const notAbandoningShelter = keepsProtectedPiecesSheltered.length > 0 ? keepsProtectedPiecesSheltered : riskAwareMoves
    // Requested directly ("EL BOT DEBE DE INTENTAR COLOCAR LOS PEONES EN CASILLAS PROTEGIDAS Y NO
    // ABANDONARLAS SI NO ES NECESARIO PARA NO ARRIESGAR Y ELIMINAR SI LES ES POSIBLE" - the bot
    // should try to place pawns on protected squares, and not abandon them unless necessary, to
    // avoid risk, and eliminate if possible): keepsProtectedPiecesSheltered right above only ever
    // stops a piece from *leaving* a protected square it already occupies - nothing anywhere in
    // this chain ever preferred *landing* on one over an equally-legal non-safe destination in the
    // first place. Same "unless it captures" exemption as every risk-avoidance preference above -
    // a capture landing on an unprotected square must never lose out to a purely defensive,
    // non-capturing move just because the latter happens to land somewhere safer.
    const preferSafeLanding = notAbandoningShelter.filter(
      (m) => (m.resultingTrackPosition !== -1 && this.session.board.safeTrackIndices.has(m.resultingTrackPosition)) || wouldCapture(this.session.board, m, this.session.players, false),
    )
    const finalMoves = preferSafeLanding.length > 0 ? preferSafeLanding : notAbandoningShelter
    // Reported directly, with the client's own rulebook page: a capture's 20-square reward is a
    // genuine choice - "Move one Pawn 20 spaces" OR "Move one Pawn 10 spaces and another pawn 10
    // spaces" - both are real, already-working options (verified directly: turnManager.ts's own
    // offerReward offers both amounts together for every eligible piece). But a naive "always pick
    // the first option" bot never explores the split, since offerReward lists the full-amount
    // moves before the split ones, so moves[0] during a reward is *always* the full amount in one
    // piece. A human who only ever watches bot play would see nothing but "one pawn takes the
    // whole 20" turn after turn - indistinguishable from the split simply not existing, even though
    // it's fully implemented and available to a human player. Every move in a reward offer shares
    // the same diceSource ('reward') - not mixed with an ordinary dieA/dieB/sum offer - so
    // preferring the smaller amount present only ever kicks in for an actual reward decision.
    //
    // Reported directly again, with a screen recording ("Había dos peones fuera. Movió uno solo
    // 10... Los otros 10 se perdieron, no movió nadie y pasó el turno" - there were two pawns out,
    // it moved only one 10, the other 10 was lost, nobody moved, and the turn passed): the blind
    // "always prefer the minimum amount" above never checked whether a second, genuinely different
    // piece could actually use the complementary half before committing to the split - "two pawns
    // out" doesn't mean the *other* one has a legal move for this exact reward distance from
    // wherever it happens to sit (e.g. too close to its own home entrance for a valid landing).
    // Reproduced directly: with only the capturing piece itself eligible for the 10-split, the old
    // logic still took the 10 (throwing away the other 10 it could have kept by taking the same
    // piece's own, equally-available 20 instead) and forfeited the remainder outright. Only worth
    // exploring the split when at least one *other* piece is genuinely eligible for it - otherwise
    // every "split" here is really just this one piece giving up half its own reward for nothing.
    const isRewardOffer = finalMoves[0]?.diceSource === 'reward'
    const minRewardAmount = isRewardOffer ? Math.min(...finalMoves.map((c) => c.amount)) : 0
    const splitOptions = finalMoves.filter((m) => m.amount === minRewardAmount)
    const splitPieceKeys = new Set(splitOptions.map((m) => `${m.piece.color}:${m.piece.pieceIndex}`))
    const splitHasGenuineSecondBeneficiary = splitPieceKeys.size > 1
    const rewardCandidates = isRewardOffer && splitHasGenuineSecondBeneficiary ? splitOptions : finalMoves
    // Requested directly ("el bot, si puede eliminar un peón de otro jugador sin riesgo, debe
    // hacerlo" - the bot, if it can eliminate an opponent's pawn without risk, must do so): a
    // capturing move already surviving every filter above (doesn't form an own barrier, doesn't
    // land on or expose itself to an opposing Parkiller) is exactly a "risk-free" capture in this
    // file's own established sense - previously the selection below just fell through to whichever
    // move happened to come first, with no preference for capturing at all, even when one was
    // sitting right there in the candidate list. Parkiller captures aren't covered here (allowParkillerCapture
    // = false) - those only ever apply on the specific roll that produced doubles, tracked
    // separately as TurnManager-internal state this class has no access to, and this request was
    // specifically about eliminating a pawn.
    // Requested directly ("cuando cuente las recompensas idem: debe ver si elimina algún peón en
    // algún salto de 10 o se cae sobre un parki y se queda eliminado" - when counting rewards,
    // likewise: check whether it eliminates a pawn on some 10-jump, or lands on a Parki and gets
    // eliminated itself): a reward move can capture too (PC5 chains a fresh 20 on top of the
    // current one) - checked against every reward-move option in finalMoves, not just the
    // amount-narrowed rewardCandidates above, so a capturing move using the full amount isn't
    // silently dropped by the split-exploration preference just because a non-capturing split
    // option happens to use less. The Parki-risk half of this same request is already covered -
    // wouldWalkIntoUnprotectedParki/wouldLeavePieceExposedToParkiller above run on every move
    // regardless of diceSource, reward moves included.
    const capturingMoves = finalMoves.filter((m) => wouldCapture(this.session.board, m, this.session.players, false))
    const candidates = capturingMoves.length > 0 ? capturingMoves : rewardCandidates
    // Requested directly ("si no se puede mover un peón el total de los dos dados debe moverse con
    // el valor superior y si no es posible con el inferior pero no elegir el inferior y quedarse
    // sin utilizar el valor del otro dado" - if a pawn can't move with the sum of both dice, it
    // should move with the higher value, falling back to the lower one only if that's not
    // possible, but never choosing the lower one while leaving the other die's value unused): the
    // sum is always >= either individual die, so simply preferring the largest `amount` among the
    // remaining safe candidates already gets this ordering for free - sum first when a piece can
    // use it, else whichever single die's own move goes farther. `>` (not `>=`) keeps the earliest
    // candidate on a tie, so this doesn't disturb the reward-split preference above (every
    // candidate there already shares the same minimum amount).
    const largestAmount = candidates.reduce((best: MoveOption | undefined, m) => (best === undefined || m.amount > best.amount ? m : best), undefined)
    const chosen = largestAmount ?? finalMoves[0] ?? safeMoves[0] ?? nonBarrierMoves[0] ?? moves[0]
    // Fired now, not inside the scheduled callback below - the highlight should cover this whole
    // think-delay (see this class's own pieceHighlighted doc comment), not just flash right before
    // the move actually submits.
    this.pieceHighlighted.emit(chosen.piece)
    this.scheduleRespectingBusy(this.thinkDelayMs, () => {
      if (this.session.currentPlayer.color !== color) {
        this.pieceHighlighted.emit(null) // stale - nothing will submit, so nothing should stay lit
        return
      }
      // This move's own hop animation - amount is the exact number of squares it covers (see
      // MoveOption), same duration-per-square PieceMesh itself uses. Set *before* submitting, not
      // after - same ordering fix as the diceRolled subscriber above and for the same reason:
      // submitMoveForBot's own submitMove (turnManager.ts) resolves synchronously and, if a second
      // die is still unspent, re-emits moveChoicesReady for it *before* this call even returns -
      // this class's own onMoveChoicesReady for that second die would then compute its own schedule
      // against whatever busyUntilMs was set *before* this move, not this move's own hop duration,
      // if that update happened after submitting instead of before.
      // See CELEBRATION_HOLD_MS's own doc comment - predictable *before* submitting from the move
      // itself (allowParkillerCapture: true here, unlike capturingMoves' own preference-ranking use
      // of this same helper just above - this is a real elimination this move is about to cause
      // either way, whichever piece the earlier preference chain actually ended up choosing, not a
      // ranking decision between candidates). The one celebration-worthy outcome this can't see
      // coming is a fully automatic Parkiller-vs-Parkiller elimination (PK6/PK7 via the black die,
      // not a pawn's own move) - session.diceRolled's own busy-window extension just above already
      // covers that hop's *animation* time, but has no way to know a Parki actually died from it;
      // BotDrivableSession's narrow interface has no event for that at all.
      const triggersCelebration = chosen.kind === 'FinishMove' || wouldCapture(this.session.board, chosen, this.session.players, true)
      this.markBusy(chosen.amount * this.hopDurationMs + this.extraBounceMs(chosen) + (triggersCelebration ? CELEBRATION_HOLD_MS : 0))
      this.pieceHighlighted.emit(null)
      this.session.submitMoveForBot(chosen.piece, chosen.amount)
    })
  }

  // True when landing here would sit this piece exactly on top of one of this same bot's *other*
  // pieces, own-color-barrier position (PC2.4) - the specific, avoidable outcome that later strands
  // the bot for however long it takes to roll a double (see onMoveChoicesReady's own comment). Not
  // scoped to any one MoveKind - a fresh barrier can form on the shared track or inside the home
  // corridor alike, matching the lock itself.
  private wouldFormOwnBarrier(move: MoveOption): boolean {
    for (const piece of this.session.currentPlayer.pieces) {
      if (piece === move.piece) continue
      if (move.resultingTrackPosition !== -1 && piece.state === 'OnTrack' && piece.trackPosition === move.resultingTrackPosition) return true
      if (move.resultingCorridorPosition !== -1 && piece.state === 'InHomeCorridor' && piece.corridorPosition === move.resultingCorridorPosition) return true
    }
    return false
  }

  // True when landing here would put this piece on an *unprotected* (non-safe-square) opposing
  // Parkiller - PK5: the pawn is sent straight back to its own yard, with no reward, losing
  // whatever progress it had made. Doesn't apply to a corridor destination (resultingTrackPosition
  // stays -1 for a CorridorMove/FinishMove - a color's own home corridor is private, no opposing
  // Parkiller can ever be there) or to a safe square (PK4: the two would simply coexist as a
  // barrier instead, no elimination). Deliberately simpler than parchisRules.ts's own
  // unprotectedOpposingParkillerColorAt - that one accounts for the mover already occupying the
  // square (called *after* the move applies); this runs *before* any move is chosen, so the
  // destination's current occupancy needs no such adjustment.
  private wouldWalkIntoUnprotectedParki(move: MoveOption): boolean {
    if (move.resultingTrackPosition === -1) return false
    if (this.session.board.safeTrackIndices.has(move.resultingTrackPosition)) return false
    for (const player of this.session.players) {
      if (player.color === move.piece.color) continue
      if (isParkillerOnTrack(player.parkiller) && player.parkiller.trackPosition === move.resultingTrackPosition) return true
    }
    return false
  }

  // True when landing here leaves this piece within an *opposing* Parkiller's own one-roll reach
  // (PK2's black die is 1-6) on an unprotected square - not an immediate collision (that's
  // wouldWalkIntoUnprotectedParki, above), but exposed to becoming one on that Parkiller's very
  // next roll. Distance is measured the way a Parkiller itself actually travels to get there -
  // backward (decreasing trackPosition) from its own current position, matching
  // resolveParkillerMove's own `mod(before - blackDieValue, trackLength)` - not simple square
  // subtraction, which would silently measure the wrong direction on a looped track. A safe square
  // is never "exposed" regardless of distance, same exemption wouldWalkIntoUnprotectedParki uses
  // (PK4: landing there just forms a barrier, no elimination either way).
  private wouldLeavePieceExposedToParkiller(move: MoveOption): boolean {
    if (move.resultingTrackPosition === -1) return false
    if (this.session.board.safeTrackIndices.has(move.resultingTrackPosition)) return false
    const trackLength = this.session.board.trackLength
    for (const player of this.session.players) {
      if (player.color === move.piece.color) continue
      if (!isParkillerOnTrack(player.parkiller)) continue
      const distance = (((player.parkiller.trackPosition - move.resultingTrackPosition) % trackLength) + trackLength) % trackLength
      if (distance >= 1 && distance <= 6) return true
    }
    return false
  }

  // Same "exposed to a one-roll capture" idea as wouldLeavePieceExposedToParkiller above, but for
  // every ordinary opposing pawn instead of just the Parkiller - the actual gap behind the client's
  // report (see onMoveChoicesReady's own comment on this call site). Direction is reversed from
  // the Parkiller check: regular pawns walk the shared track *forward* (increasing trackPosition),
  // so a threatening pawn's own distance to this move's destination is measured that way round, not
  // the Parkiller's own backward one. Checks every piece of every other color (a pawn can threaten
  // from any of its own 4 pieces, unlike a color's single Parkiller), skipping any not currently
  // OnTrack (a yard/corridor/finished piece can't roll into this square next turn regardless of
  // numeric distance). Landing exactly on a lone unprotected opposing pawn is a capture, not a
  // danger, and is already handled (rewarded, even) elsewhere - this only ever flags the square as
  // risky for what happens *after* landing, not the landing move itself.
  private wouldLeavePieceExposedToPawn(move: MoveOption): boolean {
    if (move.resultingTrackPosition === -1) return false
    if (this.session.board.safeTrackIndices.has(move.resultingTrackPosition)) return false
    const trackLength = this.session.board.trackLength
    for (const player of this.session.players) {
      if (player.color === move.piece.color) continue
      for (const piece of player.pieces) {
        if (piece.state !== 'OnTrack') continue
        const distance = (((move.resultingTrackPosition - piece.trackPosition) % trackLength) + trackLength) % trackLength
        if (distance >= 1 && distance <= 6) return true
      }
    }
    return false
  }

  private markBusy(durationMs: number): void {
    this.busyUntilMs = Date.now() + durationMs
  }

  // See CAPTURE_RETURN_HOPS' own doc comment - the extra wall-clock hop time (beyond this move's
  // own amount-hop walk) a self-eliminated mover's own bounce (PK5) adds, predicted from the same
  // MoveOption this class already has *before* submitting it via wouldWalkIntoUnprotectedParki (a
  // pre-existing helper already used elsewhere in this file for move selection, not new logic).
  // Deliberately doesn't also cover an ordinary captured-*pawn*'s own bounce-home here - every call
  // site below that can trigger one already adds the much larger, fixed CELEBRATION_HOLD_MS
  // (2000ms) on top for the exact same real-world case, comfortably covering this bounce's real
  // 3*HOP_DURATION (~1440ms) with margin to spare; adding both would double up for no real benefit
  // and, confirmed directly, throws off tests/online/botController.test.ts's own reward-timing
  // tests, which advance fake timers by an exact hand-computed duration tuned against
  // CELEBRATION_HOLD_MS alone.
  private extraBounceMs(move: MoveOption): number {
    return this.wouldWalkIntoUnprotectedParki(move) ? CAPTURE_RETURN_HOPS * this.hopDurationMs : 0
  }

  // Waits at least `baseDelayMs` (the normal "thinking" pause) but never less than whatever's
  // left of the previous action's own animation, so a slow-playing hop/spin is never cut short.
  private scheduleRespectingBusy(baseDelayMs: number, action: () => void): void {
    const remainingBusyMs = this.busyUntilMs - Date.now()
    this.schedule(action, Math.max(baseDelayMs, remainingBusyMs))
  }

  private schedule(action: () => void, delayMs: number): void {
    if (this.paused) {
      this.frozenActions.push(action)
      return
    }
    const handle = setTimeout(() => {
      this.pendingTimeouts.delete(handle)
      action()
    }, delayMs)
    this.pendingTimeouts.set(handle, action)
  }

  // See this class's own `paused` doc comment above - every currently-armed timeout is cancelled
  // and its action kept (not dropped), so resume() can re-arm it instead of that bot just going
  // silent for the rest of the game.
  pause(): void {
    if (this.paused) return
    this.paused = true
    for (const [handle, action] of this.pendingTimeouts) {
      clearTimeout(handle)
      this.frozenActions.push(action)
    }
    this.pendingTimeouts.clear()
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    const actions = this.frozenActions
    this.frozenActions = []
    // Fresh thinkDelayMs, not whatever was left of the original wait - the point of a pause is a
    // real break, not a stopwatch the player can strategically time. Each action re-checks its own
    // staleness (currentPlayer.color) before doing anything, same as every other scheduled action
    // here, so this is safe even if the game's turn somehow moved on while paused.
    actions.forEach((action) => this.schedule(action, this.thinkDelayMs))
  }

  dispose(): void {
    this.unsubscribers.forEach((off) => off())
    this.pendingTimeouts.forEach((_action, handle) => clearTimeout(handle))
    this.pendingTimeouts.clear()
    this.frozenActions = []
  }
}
