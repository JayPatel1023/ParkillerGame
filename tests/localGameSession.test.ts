import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginLocalGame } from '../src/core/gameFlow/localGameSession'
import { Dice } from '../src/core/dice'
import { BOARD_DEFINITIONS } from '../src/data/boards'
import { TURN_ORDER_BY_COUNT } from '../src/core/turnOrder'

// Real (unseeded) random dice made this test flaky - not from a real bug, confirmed directly: the
// exact same code passed or failed depending purely on unrelated timing elsewhere in the file
// (how many Math.random() calls an earlier test happened to consume first, shifting this run's own
// roll sequence enough to matter within a bounded simulated-time budget). A seeded Dice is fully
// deterministic - same rolls every run - while still exercising the real dice mechanics, unlike a
// hand-picked ScriptedDice queue that would need to be long enough to cover many bot turns. This
// specific seed is simply the first one tried that produces an early exit-roll for Red within the
// budget below; if this ever needs to change (e.g. a rules change shifts what's legal), just try
// nearby integers until one works again - the seed's value itself carries no other meaning.
const BOT_TEST_SEED = 7

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('beginLocalGame - classic hotseat (humanColor omitted)', () => {
  it('has no localPlayerColor restriction and nothing to dispose', () => {
    const session = beginLocalGame(BOARD_DEFINITIONS[2], TURN_ORDER_BY_COUNT[2])
    expect(session.turnManager.localPlayerColor).toBeUndefined()
    expect(session.dispose).toBeUndefined()
  })
})

// Reported directly ("EL JUGADOR AL INICIO DEBE PODER ELEGIR EL COLOR Y JUGAR CONTRA LOS OTROS
// OPONENTE PILOTADOS POR EL BOT" - the player should be able to choose their color and play
// against bot-piloted opponents): local play only ever had one mode before this (every color
// passed hotseat, same human). This is the new vs-bots mode's own integration test, through the
// real public entry point (beginLocalGame) rather than hand-assembling a TurnManager/BotController
// pair the way botController.test.ts's own online-focused tests do - this is specifically testing
// that *this* feature's own wiring (LocalVsBotsSession, the humanColor param) is correct, not
// BotController's own internal behavior, which is already covered there.
describe('beginLocalGame - vs bots (humanColor provided)', () => {
  it('locks localPlayerColor to the human\'s own chosen color', () => {
    const session = beginLocalGame(BOARD_DEFINITIONS[2], TURN_ORDER_BY_COUNT[2], 'Red')
    expect(session.turnManager.localPlayerColor).toBe('Red')
    // Undisposed leaves its own BotController's fake-timer-based setTimeouts pending in the
    // shared global timer queue - confirmed directly, this alone was enough to disrupt a *later*
    // test's own vi.advanceTimersByTime() calls in the same file. Every session this file creates
    // must be disposed, not just the ones a given test is actually asserting on.
    session.dispose?.()
  })

  it('auto-plays every other color with no human input, and never touches the human\'s own color', () => {
    // TURN_ORDER_BY_COUNT[2] is ['Red', 'Blue'] - Red always goes first. Blue is the human here
    // specifically so the *bot* (Red) is the one that must act first with nothing else driving it
    // - if Red were the human instead, the very first turn would never move at all (nothing in
    // this test calls requestRoll for a human seat), which would test "the game is stuck", not
    // "the bot plays autonomously".
    const session = beginLocalGame(BOARD_DEFINITIONS[2], TURN_ORDER_BY_COUNT[2], 'Blue', new Dice(BOT_TEST_SEED))

    let redExited = false
    let blueEverMoved = false
    session.turnManager.moveApplied.on((result) => {
      if (result.movedPiece.color === 'Red') redExited = true
      if (result.movedPiece.color === 'Blue') blueEverMoved = true
    })

    // Advance well past several rounds of "roll -> move" turns, real time (BotController's own
    // default think-delay/animation-budget constants) - long enough for the bot-controlled Red to
    // exit at least one piece purely on its own, with zero calls into requestRoll()/submitMove()
    // from this test.
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(1000)
    }

    expect(redExited).toBe(true)
    // Blue is the human's own color - nothing in this test ever called requestRoll()/submitMove()
    // for it, so if it moved at all, something is wrong (either the bot is driving the human's own
    // color too, or some other unrelated auto-play path exists).
    expect(blueEverMoved).toBe(false)

    session.dispose?.()
  })

  it('stops all further bot action once disposed', () => {
    const session = beginLocalGame(BOARD_DEFINITIONS[2], TURN_ORDER_BY_COUNT[2], 'Blue', new Dice(BOT_TEST_SEED))

    let redMoveCount = 0
    session.turnManager.moveApplied.on((result) => {
      if (result.movedPiece.color === 'Red') redMoveCount++
    })

    // Same budget as the "auto-plays" test above needs, with this same seed, to see Red's first
    // move at all.
    vi.advanceTimersByTime(60000)
    const countBeforeDispose = redMoveCount
    expect(countBeforeDispose).toBeGreaterThan(0) // sanity check the bot was actually playing at all

    session.dispose?.()
    vi.advanceTimersByTime(20000)
    expect(redMoveCount).toBe(countBeforeDispose) // no further moves after disposal, however long we wait
  })
})
