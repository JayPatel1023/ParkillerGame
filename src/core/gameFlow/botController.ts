import type { PieceColor } from '../pieceColor'
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
const BOT_THINK_DELAY_MS = 3000

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
// (gameFlow/ and scene/ are peers, per CLAUDE.md's layering), so the values below are duplicated
// from there and must be kept in sync: DICE_SPIN_MS matches useTurnManager.ts's own constant of
// the same name, HOP_DURATION_MS matches PieceMesh.tsx's HOP_DURATION (in seconds, *1000 here).
const DICE_SPIN_MS = 450
const HOP_DURATION_MS = 320

/** The narrow surface BotController actually needs to drive a game - satisfied structurally by
 * both HostTurnManagerBridge (online, see its own rollForBot()/submitMoveForBot() doc comments -
 * bots have no connected actor, so they bypass that class's own actor-ownership validation) and
 * LocalBotSession (local vs-bots play, src/gameFlow/localGameSession.ts - a bot there has no
 * "ownership" concept to bypass at all, since it's one shared device; rollForBot/submitMoveForBot
 * there are just plain requestRoll/submitMove under these two names). Moved here from src/online/
 * (where this class originally lived, online-only) so src/core/ - which local play's own
 * localGameSession.ts belongs to - doesn't have to depend on src/online/, a strictly higher layer
 * per CLAUDE.md's own architecture. */
export interface BotDrivableSession {
  readonly currentPlayer: PlayerState
  readonly turnStarted: Listenable<PlayerState>
  readonly diceRolled: Listenable<DiceRoll>
  readonly moveChoicesReady: Listenable<MoveOption[]>
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
  private readonly unsubscribers: Array<() => void>
  private readonly pendingTimeouts = new Set<ReturnType<typeof setTimeout>>()
  // Real time (Date.now()-based, so it advances correctly under vitest's fake timers too) before
  // which this class won't schedule its *next* action - see this file's own top comment.
  private busyUntilMs = 0
  constructor(
    session: BotDrivableSession,
    botColors: Set<PieceColor>,
    thinkDelayMs = BOT_THINK_DELAY_MS,
    hopDurationMs = HOP_DURATION_MS,
    diceSpinMs = DICE_SPIN_MS,
  ) {
    this.session = session
    this.botColors = botColors
    this.thinkDelayMs = thinkDelayMs
    this.hopDurationMs = hopDurationMs
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
      session.moveChoicesReady.on((moves) => this.onMoveChoicesReady(moves)),
    ]
  }

  private onTurnStarted(color: PieceColor): void {
    if (!this.botColors.has(color)) return
    this.scheduleRespectingBusy(this.thinkDelayMs, () => {
      if (this.session.currentPlayer.color !== color) return // stale - state moved on before this fired
      this.session.rollForBot()
    })
  }

  private onMoveChoicesReady(moves: MoveOption[]): void {
    if (moves.length === 0) return
    const color = this.session.currentPlayer.color
    if (!this.botColors.has(color)) return
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
    const chosen = nonBarrierMoves[0] ?? moves[0]
    this.scheduleRespectingBusy(this.thinkDelayMs, () => {
      if (this.session.currentPlayer.color !== color) return
      // This move's own hop animation - amount is the exact number of squares it covers (see
      // MoveOption), same duration-per-square PieceMesh itself uses. Set *before* submitting, not
      // after - same ordering fix as the diceRolled subscriber above and for the same reason:
      // submitMoveForBot's own submitMove (turnManager.ts) resolves synchronously and, if a second
      // die is still unspent, re-emits moveChoicesReady for it *before* this call even returns -
      // this class's own onMoveChoicesReady for that second die would then compute its own schedule
      // against whatever busyUntilMs was set *before* this move, not this move's own hop duration,
      // if that update happened after submitting instead of before.
      this.markBusy(chosen.amount * this.hopDurationMs)
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

  private markBusy(durationMs: number): void {
    this.busyUntilMs = Date.now() + durationMs
  }

  // Waits at least `baseDelayMs` (the normal "thinking" pause) but never less than whatever's
  // left of the previous action's own animation, so a slow-playing hop/spin is never cut short.
  private scheduleRespectingBusy(baseDelayMs: number, action: () => void): void {
    const remainingBusyMs = this.busyUntilMs - Date.now()
    this.schedule(action, Math.max(baseDelayMs, remainingBusyMs))
  }

  private schedule(action: () => void, delayMs: number): void {
    const handle = setTimeout(() => {
      this.pendingTimeouts.delete(handle)
      action()
    }, delayMs)
    this.pendingTimeouts.add(handle)
  }

  dispose(): void {
    this.unsubscribers.forEach((off) => off())
    this.pendingTimeouts.forEach((handle) => clearTimeout(handle))
    this.pendingTimeouts.clear()
  }
}
