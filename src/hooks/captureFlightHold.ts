// Tiny, framework-independent timer wrapper behind useTurnManager.ts's own captureFlightPending
// state - see that hook's own doc comment for exactly why a captured piece's own separate "flung
// home" bounce-home animation (BoardScene.tsx's own captureFlights) needs an explicit hold there
// at all, distinct from moveAnimation/parkillerAnimation themselves. Pulled out as its own plain
// class (no React, no setTimeout-inside-an-effect subtlety around when to (re)schedule vs. clean
// up) purely so this "retrigger restarts the clock" behavior is directly unit-testable (see
// tests/captureFlightHold.test.ts) - this project has no React hook-testing harness
// (@testing-library/react or similar) to exercise useTurnManager.ts's own state directly.
export class CaptureFlightHoldTracker {
  private timeout: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly onChange: (pending: boolean) => void,
    private readonly holdMs: number,
  ) {}

  /** Call whenever a capturing move's own hop animation has just finished - the exact trailing
   * edge BoardScene.tsx's own captureFlights spawn off of (moveAnimation/parkillerAnimation going
   * from "had a capture" to null). (Re)starts the hold from now, cancelling any timer already
   * running - two captures shortly apart (a reward chain, a double's own bonus die) resolve off the
   * *second* one's own clock, not the first's, so the hold never clears early while a later
   * capture's own flight is still the one actually playing. */
  trigger(): void {
    if (this.timeout) clearTimeout(this.timeout)
    this.onChange(true)
    this.timeout = setTimeout(() => {
      this.timeout = null
      this.onChange(false)
    }, this.holdMs)
  }

  /** Cancels any running hold with no final onChange(false) call - for unmount only, where there's
   * no state left to update. */
  dispose(): void {
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = null
  }
}
