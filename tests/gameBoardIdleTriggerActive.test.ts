import { describe, expect, it } from 'vitest'
import { computeIdleTriggerActive } from '../src/ui/GameBoardScreen'

// Reported directly, via a full audit: the idle nudge/warning/auto-play sequence only ever checked
// `paused` - opening Help, Sound Settings, or the exit-confirm dialog and leaving it open let the
// 10s-then-10s local countdown keep running right underneath it (its own overlay's z-index sits
// above all three, so it visually covered whichever one was open too), and once it hit 0,
// autoPlayIdleTurn() actually rolled the dice / picked a move for the player while they were still
// reading. See computeIdleTriggerActive's own doc comment in GameBoardScreen.tsx.
describe('computeIdleTriggerActive', () => {
  const base = { canRoll: true, awaitingPieceChoice: false, showingHelp: false, showingSoundSettings: false, confirmingExit: false }

  it('is active when the player can roll and no dialog is open', () => {
    expect(computeIdleTriggerActive(base)).toBe(true)
  })

  it('is active while awaiting a piece choice too, same as canRoll', () => {
    expect(computeIdleTriggerActive({ ...base, canRoll: false, awaitingPieceChoice: true })).toBe(true)
  })

  it('is not active while Help is open, even though the player could otherwise roll', () => {
    expect(computeIdleTriggerActive({ ...base, showingHelp: true })).toBe(false)
  })

  it('is not active while Sound Settings is open', () => {
    expect(computeIdleTriggerActive({ ...base, showingSoundSettings: true })).toBe(false)
  })

  it('is not active while the exit-confirm dialog is open', () => {
    expect(computeIdleTriggerActive({ ...base, confirmingExit: true })).toBe(false)
  })

  it('is not active while awaiting a piece choice with a dialog open either', () => {
    expect(computeIdleTriggerActive({ ...base, canRoll: false, awaitingPieceChoice: true, showingHelp: true })).toBe(false)
  })

  it('is not active with neither canRoll nor awaitingPieceChoice, regardless of dialogs', () => {
    expect(computeIdleTriggerActive({ ...base, canRoll: false })).toBe(false)
  })
})
