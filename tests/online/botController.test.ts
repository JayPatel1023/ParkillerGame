import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardData } from '../../src/core/board/boardData'
import type { DiceLike } from '../../src/core/dice'
import { createPlayerState } from '../../src/core/gameFlow/playerState'
import { TurnManager } from '../../src/core/gameFlow/turnManager'
import type { PieceColor } from '../../src/core/pieceColor'
import { defaultRuleSettings } from '../../src/core/rules/ruleSettings'
import { BotController } from '../../src/core/gameFlow/botController'
import { RecordingDice } from '../../src/online/dice'
import { HostTurnManagerBridge } from '../../src/online/HostTurnManagerBridge'
import { FakeRoomNetwork } from './fakeRoomTransport'

// Same technique as turnManager.test.ts's own ScriptedDice - a fixed, hand-picked sequence
// (RecordingDice needs a real DiceLike to wrap, not a bare array).
class ScriptedDice implements DiceLike {
  private queue: number[]
  constructor(queue: number[]) {
    this.queue = [...queue]
  }
  roll(): number {
    const next = this.queue.shift()
    if (next === undefined) throw new Error('ScriptedDice ran out of scripted rolls')
    return next
  }
}

const MASTER_ACTOR = 1

function buildTestBoard(): BoardData {
  return {
    playerCount: 2,
    trackLength: 20,
    lanes: {
      Red: { color: 'Red', entryTrackIndex: 0, homeEntranceTrackIndex: 19, corridorLength: 6 },
      Blue: { color: 'Blue', entryTrackIndex: 10, homeEntranceTrackIndex: 9, corridorLength: 6 },
    },
    safeTrackIndices: new Set([0, 10]),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BotController', () => {
  it('auto-plays every bot-assigned seat with no human/network input at all', () => {
    const board = buildTestBoard()
    const players = [createPlayerState('Red', board), createPlayerState('Blue', board)]
    const dice = new RecordingDice() // real randomness is fine here - bots just need *a* legal move to eventually appear
    const inner = new TurnManager(board, players, defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    // No actorColors entries at all - both seats are bots, nobody is a connected human actor.
    const host = new HostTurnManagerBridge(inner, dice, players, transport, new Map<number, PieceColor>())
    const bots = new BotController(host, new Set<PieceColor>(['Red', 'Blue']), 10, 2, 2)

    // Tracked via the moveApplied event, not a final-state snapshot: real gameplay can send an
    // exited piece straight back to the yard again (captured, or bounced by an opposing Parkiller -
    // PK5), so checking pieces.some(state !== 'InYard') only at the very end can go right back to
    // false through no fault of the bot at all, on nothing more than unlucky timing of that one
    // snapshot - flaky for a reason unrelated to what this test actually means to verify (that each
    // bot can act autonomously at all). "Ever exited" is immune to that coincidence.
    let redExited = false
    let blueExited = false
    inner.moveApplied.on((result) => {
      if (result.movedPiece.color === 'Red') redExited = true
      if (result.movedPiece.color === 'Blue') blueExited = true
    })

    host.start()

    // Advance well past several rounds of "roll (10ms) -> move (10ms)" turns - the bots alone
    // should exit at least one piece each without anything else driving them.
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(15)
    }

    expect(redExited).toBe(true)
    expect(blueExited).toBe(true)

    bots.dispose()
  })

  // Reported directly ("두번째 옮길차례가 되면 한참있다가 움직인다" - the second move waits a long
  // while): the *second* piece-move of a single turn (spending the second die, after the first is
  // already submitted) is scheduled using the busy window the roll itself set - and this class used
  // to budget a flat 18-square worst case for the Parkiller's own hop there, regardless of the
  // actual black die rolled. Verified directly against resolveParkillerMove (turnManager.ts): a
  // single roll's Parkiller hop is always capped at the black die's own value (1-6). The *first*
  // move of a turn is scheduled synchronously inside rollForBot() itself, before that busy window
  // is even set, so it was never actually affected by this - only the second one was, which is
  // exactly the "first move is fine, second is slow" pattern reported.
  it("budgets the second move of a turn by the actual black die rolled, not a fixed worst case", () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5 // dieA moves this one
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 8 // dieB moves this one - two independent moves this roll
    // dieA=2, dieB=4 (not 3 - 2+3 sums to the exit roll, 5, which with red's other pieces still in
    // the yard would make the exit mandatory and mask the very thing this test means to isolate),
    // blackDie=1 (small, the case under test).
    const dice = new RecordingDice(new ScriptedDice([2, 4, 1]))
    const inner = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const host = new HostTurnManagerBridge(inner, dice, [red, blue], transport, new Map<number, PieceColor>())
    const thinkDelayMs = 50
    const hopDurationMs = 100
    const diceSpinMs = 50
    const bots = new BotController(host, new Set<PieceColor>(['Red']), thinkDelayMs, hopDurationMs, diceSpinMs)

    let redMoveCount = 0
    inner.moveApplied.on((result) => {
      if (result.movedPiece.color === 'Red') redMoveCount++
    })

    host.start()
    vi.advanceTimersByTime(thinkDelayMs) // the roll fires
    vi.advanceTimersByTime(thinkDelayMs) // the first move (piece0, dieA) fires right after
    expect(redMoveCount).toBe(1)

    // From here, the old behavior (18-square fixed budget) would leave the second move waiting
    // until well past diceSpin + 18*hopDurationMs = 50 + 1800 = 1850ms after the roll; the fix's
    // own budget (blackDie=1) is diceSpin + 1*hopDurationMs = 150ms after the roll. Advancing to
    // 400ms total (from start) is comfortably past the fix's own expected time and comfortably
    // short of the old behavior's.
    vi.advanceTimersByTime(400 - thinkDelayMs * 2)
    expect(redMoveCount).toBe(2)

    bots.dispose()
  })

  // Reported directly, client visibly frustrated: a color could get stuck for many consecutive
  // turns after a bot carelessly walked itself into forming its own barrier with no strategic
  // reason to - once formed, a barrier's own two pieces are locked in place until a double breaks
  // it open, and a naive "always pick moves[0]" bot has no notion of avoiding that self-inflicted
  // wait. Reproduced directly with a stress test: streaks of up to 16 consecutive wasted turns for
  // a single color once stuck this way.
  it('avoids forming a new own-color barrier when a non-barrier move is also available', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 7 // dieA moves piece0 exactly onto piece1 - a barrier, if picked
    // dieA=2: piece0 (5->7, barrier with piece1) is offered first (getValidMoves walks pieces in
    // index order, and dieA is combined into the move list before dieB) - moves[0] under the old
    // "always pick the first option" behavior. dieB=4 (and every other combination) offers plenty
    // of alternatives that don't coincide with piece1's own square at all.
    const dice = new RecordingDice(new ScriptedDice([2, 4, 1]))
    const inner = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const host = new HostTurnManagerBridge(inner, dice, [red, blue], transport, new Map<number, PieceColor>())
    const bots = new BotController(host, new Set<PieceColor>(['Red']), 10, 2, 2)

    host.start()
    vi.advanceTimersByTime(10) // the roll fires
    vi.advanceTimersByTime(10) // the first move fires

    // Whichever move actually got picked, it must not have landed piece0 on piece1's own square -
    // the one avoidable, self-inflicted barrier this roll could have formed.
    const onSameSquare = red.pieces[0].state === 'OnTrack' && red.pieces[0].trackPosition === red.pieces[1].trackPosition
    expect(onSameSquare).toBe(false)

    bots.dispose()
  })

  it('a color not in botColors never receives an automatic roll', () => {
    const board = buildTestBoard()
    const players = [createPlayerState('Red', board), createPlayerState('Blue', board)]
    const dice = new RecordingDice()
    const inner = new TurnManager(board, players, defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const host = new HostTurnManagerBridge(inner, dice, players, transport, new Map([[MASTER_ACTOR, 'Red' as PieceColor]]))
    // Only Blue is a bot - Red is the (human, unattended in this test) Master seat.
    const bots = new BotController(host, new Set<PieceColor>(['Blue']), 10)

    host.start()
    expect(host.currentPlayer.color).toBe('Red') // Red goes first and is not a bot

    for (let i = 0; i < 20; i++) vi.advanceTimersByTime(15)

    // Nothing should have moved - Red never auto-rolls, and Blue never gets a turn to auto-roll on.
    expect(players[0].pieces.every((p) => p.state === 'InYard')).toBe(true)
    expect(players[1].pieces.every((p) => p.state === 'InYard')).toBe(true)

    bots.dispose()
  })
})
