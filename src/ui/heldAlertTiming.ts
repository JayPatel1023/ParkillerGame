// Pure timing rule behind GameBoardScreen.tsx's own useHeldAlert - pulled out so it's directly
// unit-testable (this project has no React-rendering harness; same reasoning as
// toastFadeOutHold.ts/turnHandoffDelay.ts).
//
// Reported directly, with a screenshot ("아직 다 이동하지도 않고 이동하려고 하는 참인데 왜 벌써
// 주사위는 제자리로 돌아가 얼마만큼 움직여야 하는지 알 수 없게 하니" - the piece hasn't even
// finished moving, it's only about to, yet the dice have already reset so there's no way to tell how
// far to move): all three dice were sitting on their reset face (1-1-1) with a piece choice still
// pending. Two separate causes, both here:
//
// 1. useHeldAlert's own max-hold ceiling (added for the "Perdida" toast, whose source value could
//    stay non-null forever if a player went idle) also applied to the dice, whose source (lastRoll)
//    stays non-null for the WHOLE roll - through the piece choice and every hop - so the numbers were
//    being wiped a fixed 3.8s after the reveal no matter what was still happening on screen. The
//    dice must last as long as the roll itself is live, so they opt out of that ceiling.
// 2. Even once lastRoll does clear (the instant the last die is spent), the piece's own hop is only
//    just starting - the numbers must stay until it lands. `blocked` holds the clear while
//    animations are still playing, and `lingerMs` keeps them up a beat after the piece settles so
//    the final numbers can be read against where it ended up.
export interface HeldAlertClearParams {
  /** Time since the held value was last (re)shown. */
  elapsedMs: number
  /** Minimum viewing time from that moment. */
  holdMs: number
  /** Extra minimum time after `blocked` last went false. */
  lingerMs: number
  /** Time since `blocked` last went false. */
  msSinceUnblocked: number
  /** True while something (a piece's hop, a capture bounce) is still animating. */
  blocked: boolean
}

/** How long to wait before clearing a held value whose source has gone null, or null to not schedule
 * a clear at all yet (blocked - the caller re-evaluates the moment `blocked` flips back to false). */
export function heldAlertClearDelayMs(p: HeldAlertClearParams): number | null {
  if (p.blocked) return null
  const holdRemaining = Math.max(0, p.holdMs - p.elapsedMs)
  const lingerRemaining = Math.max(0, p.lingerMs - p.msSinceUnblocked)
  return Math.max(holdRemaining, lingerRemaining)
}
