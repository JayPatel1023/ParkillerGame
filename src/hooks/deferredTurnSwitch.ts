// Tiny, framework-independent timer wrapper behind useTurnManager.ts's own cross-player
// turnStarted branch - see that hook's own TURN_CHANGE_HOLD_MS doc comment for why a genuine
// handoff to a *different* player needs an explicit reveal hold at all. Pulled out as its own
// plain class, same reasoning as captureFlightHold.ts's own CaptureFlightHoldTracker (see that
// file's doc comment) - this project has no React hook-testing harness (@testing-library/react or
// similar) to exercise useTurnManager.ts's own state directly, so the logic that decides *when*
// exactly to flip currentPlayer needs to live somewhere plain-.test.ts can reach it.
//
// Found via close video review of a real local recording (b2.mp4, ~t=352s): the header's "TURNO
// DE {color}" title and avatar (GameBoardScreen.tsx) read `currentPlayer` directly, with no
// animationsSettled gate of their own - only the roll button's `canRoll` waits on that. A bare
// `setTimeout(..., TURN_CHANGE_HOLD_MS)` (3000ms) starting the instant turnStarted fires was "long
// enough" for an ordinary short move, but the piece's own hop animation runs at HOP_DURATION
// (0.48s) *per square* (PieceMesh.tsx) - trivially longer than 3s for anything past ~6 squares,
// which an ordinary dice sum (up to 12) already reaches, and which the game's own 10-/20-square
// reward moves (turnManager.ts's offerReward flow) reach routinely. The result: the outgoing
// player's pawn was still visibly mid-hop while the header had already flipped to the incoming
// player, and the button (correctly gated) stayed disabled for longer than the label suggested.
//
// This tracker fixes that by requiring BOTH conditions before actually calling back: the plain
// hold has elapsed AND animationsSettled is true (the same moveAnimation/parkillerAnimation/
// captureFlightPending-derived condition GameBoardScreen's own canRoll already uses) - see
// schedule()/setAnimationsSettled() below. An ordinary short move (the common case) still switches
// right at the hold mark, since animations are already settled well before then; only a move
// whose own hop genuinely outlasts the hold gets held the extra beat.
//
// `holdMs` is passed to schedule() itself, not fixed in the constructor - useTurnManager.ts
// already estimates a per-move floor via turnHandoffDelayMs (amount*HOP_DURATION_MS, plus a
// capture's own bounce-home budget) instead of the flat TURN_CHANGE_HOLD_MS alone, which already
// closes most of this gap on its own. This tracker composes with that estimate rather than
// replacing it - it's the exact backstop for whatever the estimate still gets wrong (a reward
// chain longer than the last single move it was computed from, ordinary real-world timer/render
// jitter, etc.), not a second, competing timing scheme.
export class DeferredTurnSwitchTracker<T> {
  private timeout: ReturnType<typeof setTimeout> | null = null
  private pendingPlayer: T | null = null
  private holdElapsed = false
  // Starts true: nothing is mid-animation before any turn has even started, and a handoff whose
  // own hold elapses before this ever gets told otherwise (a same-tick turnStarted with no
  // moveAnimation/parkillerAnimation at all) should switch right away, same as before this fix.
  private animationsSettled = true

  constructor(private readonly onSwitch: (player: T) => void) {}

  /** Call the instant a turn handoff to a *different* player is detected (turnStarted's own
   * cross-player branch), with that handoff's own already-computed hold (see this class's own doc
   * comment above - typically turnHandoffDelayMs's result, not the flat constant on its own).
   * Cancels any switch already scheduled for an earlier handoff first - a chain of forfeited rolls
   * can hand off across more than one player before any of them actually gets to move, and only
   * the most recent target should ever win. */
  schedule(player: T, holdMs: number): void {
    if (this.timeout) clearTimeout(this.timeout)
    this.pendingPlayer = player
    this.holdElapsed = false
    this.timeout = setTimeout(() => {
      this.timeout = null
      this.holdElapsed = true
      this.tryApply()
    }, holdMs)
  }

  /** Call whenever animationsSettled changes (moveAnimation/parkillerAnimation/
   * captureFlightPending toggling in the owning hook) - applies the deferred switch the moment
   * both conditions finally hold, however much longer that ends up taking than the plain hold on
   * its own. A no-op call (settled flipping to false, or flipping true with nothing pending) is
   * harmless either way. */
  setAnimationsSettled(settled: boolean): void {
    this.animationsSettled = settled
    this.tryApply()
  }

  private tryApply(): void {
    if (!this.holdElapsed || !this.animationsSettled || this.pendingPlayer === null) return
    const player = this.pendingPlayer
    this.pendingPlayer = null
    this.holdElapsed = false
    this.onSwitch(player)
  }

  /** Cancels any running hold/pending switch with no final onSwitch call - for unmount only, where
   * there's no state left to update. */
  dispose(): void {
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = null
    this.pendingPlayer = null
    this.holdElapsed = false
  }
}
