import type { PieceColor } from '../core/pieceColor'
import type { MoveOption } from '../core/rules/moveOption'
import type { HostTurnManagerBridge } from './HostTurnManagerBridge'

// Purely for feel, mirrors the human roll-spin delay in useTurnManager's rollDice() - an instant
// bot turn would read as broken/too fast rather than "an opponent playing quickly".
const BOT_THINK_DELAY_MS = 700

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
  private readonly unsubscribers: Array<() => void>
  private readonly pendingTimeouts = new Set<ReturnType<typeof setTimeout>>()

  constructor(host: HostTurnManagerBridge, botColors: Set<PieceColor>, thinkDelayMs = BOT_THINK_DELAY_MS) {
    this.host = host
    this.botColors = botColors
    this.thinkDelayMs = thinkDelayMs
    this.unsubscribers = [
      host.turnStarted.on((player) => this.onTurnStarted(player.color)),
      host.moveChoicesReady.on((moves) => this.onMoveChoicesReady(moves)),
    ]
  }

  private onTurnStarted(color: PieceColor): void {
    if (!this.botColors.has(color)) return
    this.schedule(() => {
      if (this.host.currentPlayer.color !== color) return // stale - state moved on before this fired
      this.host.rollForBot()
    })
  }

  private onMoveChoicesReady(moves: MoveOption[]): void {
    if (moves.length === 0) return
    const color = this.host.currentPlayer.color
    if (!this.botColors.has(color)) return
    const chosen = moves[0]
    this.schedule(() => {
      if (this.host.currentPlayer.color !== color) return
      this.host.submitMoveForBot(chosen.piece)
    })
  }

  private schedule(action: () => void): void {
    const handle = setTimeout(() => {
      this.pendingTimeouts.delete(handle)
      action()
    }, this.thinkDelayMs)
    this.pendingTimeouts.add(handle)
  }

  dispose(): void {
    this.unsubscribers.forEach((off) => off())
    this.pendingTimeouts.forEach((handle) => clearTimeout(handle))
    this.pendingTimeouts.clear()
  }
}
