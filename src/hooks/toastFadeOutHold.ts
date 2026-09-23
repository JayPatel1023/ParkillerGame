// Tiny, framework-independent timer wrapper behind RewardToast.tsx's own fade-out - same
// reasoning and same "pull it out of the hook so it's directly unit-testable" motivation as
// CaptureFlightHoldTracker (captureFlightHold.ts), which this file deliberately mirrors: this
// project has no React-component-rendering harness (@testing-library/react or similar) to mount
// RewardToast itself and observe when it actually unmounts.
//
// Found via close video review of a real local vs-bot recording (the '+10 ¡Meta!' toast at
// b2_0516-0520 was still fully opaque with no sign of fading 4+ seconds after it first appeared -
// tracing it further confirmed it never fades, for ANY reward, ever): RewardToast.tsx's own doc
// comment at the top of that file states the intended design outright ("bounces in center-stage,
// holds briefly, fades out"), but the component only ever defined pop-IN keyframes
// (reward-toast-pop/reward-toast-forfeit-pop) and returned null the INSTANT its held value (see
// GameBoardScreen.tsx's own useHeldAlert) went back to null - no fade-out was ever implemented,
// from the file's original commit onward. It didn't "linger" (useHeldAlert's own minimum-hold
// timing is correct and untouched here) - it just vanished with a hard cut instead of fading.
//
// Fix: keep reporting the toast's last real content for `fadeOutMs` past the moment the
// underlying grant clears, flagged `exiting` so RewardToast.tsx can swap in a real
// @keyframes-driven fade-out class against it, then actually drop it once that plays out.
export interface ToastDisplayState<T> {
  content: T
  exiting: boolean
}

export class ToastFadeOutTracker<T> {
  private timeout: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly onChange: (state: ToastDisplayState<T> | null) => void,
    private readonly fadeOutMs: number,
  ) {}

  /** Call whenever the toast's underlying value is non-null - a fresh grant, or the same one
   * continuing to hold. Cancels any fade-out already in progress (a second event landing before
   * the first one's own fade-out timer ever fires gets its own full, opaque re-entrance rather
   * than inheriting a fade meant for the previous one - same "retrigger restarts it" reasoning as
   * CaptureFlightHoldTracker.trigger()) and reports the content immediately, not exiting. */
  show(content: T): void {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
    this.onChange({ content, exiting: false })
  }

  /** Call once, exactly when the toast's underlying value goes from non-null to null.
   * `lastContent` is whatever `show` most recently reported - kept on screen (flagged `exiting`
   * so a fade-out animation can actually play against real content) instead of unmounting
   * immediately, then genuinely cleared (onChange(null)) once `fadeOutMs` elapses. */
  hide(lastContent: T): void {
    this.onChange({ content: lastContent, exiting: true })
    this.timeout = setTimeout(() => {
      this.timeout = null
      this.onChange(null)
    }, this.fadeOutMs)
  }

  /** Cancels any running fade-out with no trailing onChange(null) call - for unmount only, where
   * there's no state left to update. */
  dispose(): void {
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = null
  }
}
