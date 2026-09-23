// Pulled out as its own plain, framework-independent function - same "no React hook-testing
// harness in this project" reasoning as CaptureFlightHoldTracker (see that file's own doc
// comment) - purely so this delay math is directly unit-testable (see
// tests/turnHandoffDelay.test.ts) without needing to exercise useTurnManager.ts's own state.
//
// Found via close video review of a real local 2-player recording: the header ("TURNO DE
// {color}"/"Esperando el turno de {color}...", GameBoardScreen.tsx) flipped to the incoming
// player, and that player's dice started their own spin, a beat *before* the outgoing player's
// just-submitted pawn had actually finished sliding to its final square on screen. Root cause:
// useTurnManager.ts's own turnStarted handler used to hold a genuine different-player handoff back
// by a single flat TURN_CHANGE_HOLD_MS (3000ms), with no regard for how long the move that just
// triggered this handoff will actually take to animate - amount*HOP_DURATION_MS (HOP_DURATION in
// PieceMesh.tsx), same as any other hop, plus CAPTURE_RETURN_HOPS*HOP_DURATION_MS more when it
// captured. A combined two-dice move (e.g. 4+5=9) takes 9*480ms=4320ms, comfortably longer than
// the flat 3000ms hold, so the handoff fired - and the header/dice flipped to the next player -
// while the previous move's own hop was still genuinely playing.
//
// This is exactly the same "budget the real hop-animation time, not a flat delay" fix already
// applied on the bot side (botController.ts's own markBusy(result.amount*hopDurationMs+
// extraBounceMs)) and the online-replay side (RemoteTurnManager.ts's own
// Math.max(REMOTE_MOVE_PACING_MS, result.amount*HOP_DURATION_MS+extraBounceMs)) - RemoteTurnManager
// even says, in its own REMOTE_MOVE_PACING_MS doc comment, that "no separate handling needed here"
// for the different-player handoff case because TURN_CHANGE_HOLD_MS "already covers" it - which
// this bug shows wasn't actually true. Applying the identical Math.max(...) pattern here closes
// the gap the same way it already was on those other two paths.
//
// Never lets an ordinary short move's own handoff take *less* than baseHoldMs (Carlos's own
// repeatedly-stated 2-3 second reveal window - see TURN_CHANGE_HOLD_MS's own doc comment in
// useTurnManager.ts) - only ever stretches the hold longer, for a move whose own hop genuinely
// needs more time than that to finish playing.
export function turnHandoffDelayMs(baseHoldMs: number, amount: number, hopDurationMs: number, captured: boolean, captureReturnHops: number): number {
  const hopBudgetMs = amount * hopDurationMs + (captured ? captureReturnHops * hopDurationMs : 0)
  return Math.max(baseHoldMs, hopBudgetMs)
}
