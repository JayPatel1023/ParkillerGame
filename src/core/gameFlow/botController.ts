import type { PieceColor } from '../pieceColor'
import type { MoveOption, MoveResult } from '../rules/moveOption'
import type { Piece } from '../pieces/piece'
import type { DiceRoll } from './turnManager'
import type { Listenable } from './turnManagerLike'
import type { PlayerState } from './playerState'

// Purely for feel, mirrors the human roll-spin delay in useTurnManager's rollDice() - an instant
// bot turn would read as broken/too fast rather than "an opponent playing quickly".
const BOT_THINK_DELAY_MS = 700

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
  // The most recent roll's own black die (1-6) - see onTurnStarted's own use of it below. Reported
  // directly ("두번째 옮길차례가 되면 한참있다가 움직인다" - the second move waits a long while):
  // this class used to budget a flat, wildly overcautious 18-square worst case for the Parkiller's
  // own hop after *every* roll, on the mistaken assumption that a single roll could span its whole
  // home-corridor length plus more. Verified directly against resolveParkillerMove
  // (turnManager.ts): a single roll's Parkiller hop is *always* capped at the black die's own value
  // (1-6, whether crossing corridor, entering the loop, or a mix) - PK1's own "distance always
  // equals the die" guarantee. Tracking the die's real value here (via diceRolled, which fires
  // synchronously inside rollForBot() below - see HostTurnManagerBridge's own performRoll()) budgets
  // the *actual* worst case for that specific roll instead of a fixed, mostly-wrong overestimate.
  private lastBlackDie = 6

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
      session.diceRolled.on((roll) => (this.lastBlackDie = roll.blackDie)),
      session.moveChoicesReady.on((moves) => this.onMoveChoicesReady(moves)),
    ]
  }

  private onTurnStarted(color: PieceColor): void {
    if (!this.botColors.has(color)) return
    this.scheduleRespectingBusy(this.thinkDelayMs, () => {
      if (this.session.currentPlayer.color !== color) return // stale - state moved on before this fired
      this.session.rollForBot()
      // A roll always plays the white-dice spin, and may also play the Parkiller's own hop (up to
      // lastBlackDie squares, just updated by the diceRolled subscription above, synchronously,
      // before this line runs) - nothing scheduled after this should fire before both have had
      // time to finish.
      this.markBusy(this.diceSpinMs + this.lastBlackDie * this.hopDurationMs)
    })
  }

  private onMoveChoicesReady(moves: MoveOption[]): void {
    if (moves.length === 0) return
    const color = this.session.currentPlayer.color
    if (!this.botColors.has(color)) return
    const chosen = moves[0]
    this.scheduleRespectingBusy(this.thinkDelayMs, () => {
      if (this.session.currentPlayer.color !== color) return
      this.session.submitMoveForBot(chosen.piece, chosen.amount)
      // This move's own hop animation - amount is the exact number of squares it covers (see
      // MoveOption), same duration-per-square PieceMesh itself uses.
      this.markBusy(chosen.amount * this.hopDurationMs)
    })
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
