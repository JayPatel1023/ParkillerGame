import { describe, expect, it } from 'vitest'
import { computeVisibleRollForOwner } from '../src/ui/GameBoardScreen'

// See computeVisibleRollForOwner's own doc comment (src/ui/GameBoardScreen.tsx) for the bug this
// pins down: a real local recording (b3_0131.jpg) caught a bot's immediately-forfeited roll (zero
// legal moves on either die) leaking through and getting narrated under the *next* player's own
// freshly-flipped "TURNO DE X" header for ~2s - "Dados: 4 y 5 · Parkiller: 4" shown while no pawn
// anywhere on the board had actually moved, right before the header properly collapsed to the
// fresh "Tire los dados para empezar su turno" prompt.
//
// Root cause (useTurnManager.ts/GameBoardScreen.tsx): on a forfeited roll, turnManager.ts fires
// diceRolled + moveNotPossible('none') + turnStarted(nextPlayer) all synchronously, but
// useTurnManager.ts's own reveal timers for those two events are independent and different
// lengths - lastRoll (the real dice values) reveals after DICE_SPIN_MS (2000ms), still crediting
// the *forfeiting* player (currentPlayer hasn't flipped yet); currentPlayer only flips to the next
// player TURN_CHANGE_HOLD_MS (3000ms) later. GameBoardScreen's own visibleRoll (useHeldAlert)
// captures its display hold at the first of those two instants, while currentPlayer is still the
// forfeiting player - so its hold clock (holdMsFor's short bot pacing) still has time left on it a
// second later when currentPlayer flips, and it keeps returning the stale roll under the new
// player's header until that leftover hold finally expires.
const dieA = 4
const dieB = 5
const blackDie = 4
const roll = { dieA, dieB, blackDie }

describe('computeVisibleRollForOwner - GameBoardScreen turn-status header / bot narration', () => {
  it('shows the roll once it is revealed and genuinely still belongs to the current player (baseline, unchanged behavior)', () => {
    expect(
      computeVisibleRollForOwner({ visibleRoll: roll, rolling: false, rollOwnerColor: 'Red', currentPlayerColor: 'Red' }),
    ).toBe(roll)
  })

  it('the recorded bug: never shows a still-held roll once the turn has handed off to a DIFFERENT player, even though visibleRoll itself has not decayed yet', () => {
    // This is exactly the b3_0131.jpg moment: visibleRoll is still non-null (blue's own forfeited
    // roll, held over from before the handoff), but currentPlayer has already flipped to red -
    // rollOwnerColor (captured at the instant the roll first appeared, while it was still blue's
    // turn) no longer matches. Against the old code (which read visibleRoll directly, with no
    // ownership check at all) this same input would render blue's stale "Dados: 4 y 5" numbers
    // under red's own header.
    expect(
      computeVisibleRollForOwner({ visibleRoll: roll, rolling: false, rollOwnerColor: 'Blue', currentPlayerColor: 'Red' }),
    ).toBeNull()
  })

  it('still hides the roll while the dice are visibly spinning, regardless of ownership', () => {
    expect(
      computeVisibleRollForOwner({ visibleRoll: roll, rolling: true, rollOwnerColor: 'Red', currentPlayerColor: 'Red' }),
    ).toBeNull()
  })

  it('stays null when there is no roll to show at all', () => {
    expect(
      computeVisibleRollForOwner({ visibleRoll: null, rolling: false, rollOwnerColor: 'Red', currentPlayerColor: 'Red' }),
    ).toBeNull()
  })

  it('stays null before any roll has ever been owned (rollOwnerColor still at its initial null)', () => {
    expect(
      computeVisibleRollForOwner({ visibleRoll: roll, rolling: false, rollOwnerColor: null, currentPlayerColor: 'Red' }),
    ).toBeNull()
  })
})
