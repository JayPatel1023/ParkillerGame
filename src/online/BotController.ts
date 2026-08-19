import type { PieceColor } from '../core/pieceColor'
import type { MoveOption } from '../core/rules/moveOption'
import type { HostTurnManagerBridge } from './HostTurnManagerBridge'

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
// the next one - this class has no access to the scene layer's own timing constants (online/ and
// scene/ are peers, per CLAUDE.md's layering), so the values below are duplicated from there and
// must be kept in sync: DICE_SPIN_MS matches useTurnManager.ts's own constant of the same name,
// HOP_DURATION_MS matches PieceMesh.tsx's HOP_DURATION (in seconds, *1000 here).
const DICE_SPIN_MS = 450
const HOP_DURATION_MS = 320
// The Parkiller's own black die is 1-6, so an ordinary hop after a roll takes at most 6 squares'
// worth of hop time - but its very first move ever also walks the connecting path from the board's
// center hub out to the main loop first, one square at a time at the same normal pace as every
// other hop (see getParkillerFirstMoveHopWaypoints in piecePosition.ts - PK1, per the client's own
// explicit instruction that this stretch read as "just skipping/jumping over it" when it was a
// single glide instead). This class has no visibility into Parkiller.hasMoved or board data to size
// that stretch exactly (this class doesn't get told the actual black die value either, only
// MoveOption for the white dice), so this generously covers the worst case (every real board's own
// 8-square corridor + the loop-entrance square + up to 6 loop squares, with headroom for a longer
// hand-traced corridor) rather than risking an undercount on every roll, first or not. Derived from
// whichever hopDurationMs the constructor actually received (see maxParkillerHopMs below), not this
// module-level default, so a test injecting a smaller value scales this too.

/**
 * Drives every bot-assigned seat on the Master Client - bots never touch the network at all,
 * they act directly on the same authoritative HostTurnManagerBridge the Master's own UI binds to,
 * via its rollForBot()/submitMoveForBot() (which skip the actor-ownership check that
 * requestRoll()/submitMove() enforce, since a bot has no connected actor to validate against).
 *
 * Move selection for this pass is deliberately simple - the first legal option, whatever it is.
 * A real heuristic (prefer captures/finishes) is Phase 2 polish, not required to prove the
 * architecture or to make bots functional.
 */
export class BotController {
  private readonly host: HostTurnManagerBridge
  private readonly botColors: Set<PieceColor>
  private readonly thinkDelayMs: number
  private readonly hopDurationMs: number
  private readonly diceSpinMs: number
  private readonly maxParkillerHopMs: number
  private readonly unsubscribers: Array<() => void>
  private readonly pendingTimeouts = new Set<ReturnType<typeof setTimeout>>()
  // Real time (Date.now()-based, so it advances correctly under vitest's fake timers too) before
  // which this class won't schedule its *next* action - see this file's own top comment.
  private busyUntilMs = 0

  constructor(
    host: HostTurnManagerBridge,
    botColors: Set<PieceColor>,
    thinkDelayMs = BOT_THINK_DELAY_MS,
    hopDurationMs = HOP_DURATION_MS,
    diceSpinMs = DICE_SPIN_MS,
  ) {
    this.host = host
    this.botColors = botColors
    this.thinkDelayMs = thinkDelayMs
    this.hopDurationMs = hopDurationMs
    this.diceSpinMs = diceSpinMs
    this.maxParkillerHopMs = 18 * hopDurationMs
    this.unsubscribers = [
      host.turnStarted.on((player) => this.onTurnStarted(player.color)),
      host.moveChoicesReady.on((moves) => this.onMoveChoicesReady(moves)),
    ]
  }

  private onTurnStarted(color: PieceColor): void {
    if (!this.botColors.has(color)) return
    this.scheduleRespectingBusy(this.thinkDelayMs, () => {
      if (this.host.currentPlayer.color !== color) return // stale - state moved on before this fired
      this.host.rollForBot()
      // A roll always plays the white-dice spin, and may also play the Parkiller's own hop -
      // nothing scheduled after this should fire before both have had time to finish.
      this.markBusy(this.diceSpinMs + this.maxParkillerHopMs)
    })
  }

  private onMoveChoicesReady(moves: MoveOption[]): void {
    if (moves.length === 0) return
    const color = this.host.currentPlayer.color
    if (!this.botColors.has(color)) return
    const chosen = moves[0]
    this.scheduleRespectingBusy(this.thinkDelayMs, () => {
      if (this.host.currentPlayer.color !== color) return
      this.host.submitMoveForBot(chosen.piece)
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
