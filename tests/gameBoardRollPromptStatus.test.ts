import { describe, expect, it } from 'vitest'
import { computeRollPromptStatusLine } from '../src/ui/GameBoardScreen'

// Bug found by close video review of a real local recording (b2_0353.jpg vs b2_0355.jpg, ~2s
// apart): right after a turn hands off to a different player following a long move (any
// capture/finish reward, or a plain sum-dice move of 7+ squares), statusLine's final fallback
// branch (GameBoardScreen.tsx) used to render the literal "Tire los dados para empezar su turno"
// roll prompt the instant useTurnManager's fixed TURN_CHANGE_HOLD_MS elapsed and currentPlayer
// flipped - with no check at all on canRoll/animationsSettled, unlike every sibling branch of the
// same ternary. The roll button right next to it reads canRoll directly and correctly stayed
// disabled/dark for another moment, until the outgoing move's own hop animation actually finished
// - so for that window the banner told the player to roll while the button refused them.
// computeRollPromptStatusLine is the fix: it can never disagree with the button, because it's
// handed the exact same canRoll value the button's disabled attribute already reads.
describe('computeRollPromptStatusLine - GameBoardScreen turn-status header', () => {
  it('shows the roll prompt once canRoll is genuinely true (baseline, unchanged behavior)', () => {
    expect(computeRollPromptStatusLine({ canRoll: true })).toBe('Tire los dados para empezar su turno')
  })

  it('never shows the roll prompt while canRoll is still false, even though the turn has already visibly handed off', () => {
    // Mirrors the real timeline: currentPlayer/turnEndingSoon have already flipped on
    // useTurnManager's fixed TURN_CHANGE_HOLD_MS, but animationsSettled (and so canRoll) hasn't
    // caught up yet because the outgoing move's own hop animation - a long reward or sum-dice
    // move - is still genuinely running on screen.
    const line = computeRollPromptStatusLine({ canRoll: false })
    expect(line).not.toBe('Tire los dados para empezar su turno')
  })

  it('returns a stable, non-empty placeholder while canRoll is false, so the banner is never blank', () => {
    expect(computeRollPromptStatusLine({ canRoll: false })).toBe('Un momento…')
  })
})
