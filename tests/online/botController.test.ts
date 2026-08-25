import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardData } from '../../src/core/board/boardData'
import type { DiceLike } from '../../src/core/dice'
import { createPlayerState } from '../../src/core/gameFlow/playerState'
import { TurnManager } from '../../src/core/gameFlow/turnManager'
import type { PieceColor } from '../../src/core/pieceColor'
import type { Piece } from '../../src/core/pieces/piece'
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

// Same shape as tests/turnManager.test.ts's own buildBigTestBoard - a capture's own 20-square
// reward needs real track room ahead so it never nears home, unlike buildTestBoard's own
// deliberately tight 20-length track.
function buildBigTestBoard(): BoardData {
  return {
    playerCount: 2,
    trackLength: 40,
    lanes: {
      Red: { color: 'Red', entryTrackIndex: 0, homeEntranceTrackIndex: 39, corridorLength: 6 },
      Blue: { color: 'Blue', entryTrackIndex: 20, homeEntranceTrackIndex: 19, corridorLength: 6 },
    },
    safeTrackIndices: new Set([0, 20]),
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

  // Reported directly, twice over: first "두번째 옮길차례가 되면 한참있다가 움직인다" (the second
  // move waits a long while - this class used to budget a flat 18-square worst case for the
  // Parkiller's own hop after every roll, instead of the actual black die rolled), then later
  // "parki말이 다움직인다음 일반 pawn이 움직이게 해달라" (let the Parkiller finish moving, *then* let
  // the regular pawn move - the Parkiller's own hop and a pawn's first move could still overlap,
  // and separately, so could a turn's first and second pawn move). Both are the same root cause:
  // requestRoll()/submitMove() (turnManager.ts) resolve synchronously and re-emit
  // diceRolled/moveChoicesReady *before* returning control to this class's own caller, so a
  // busy-window update written *after* triggering one of those calls is always one step too late
  // to affect whatever got scheduled from the event that call just re-fired synchronously. Writing
  // each busy-window update *before* the call that can trigger the next event (diceRolled's own
  // subscriber for the Parkiller hop; this file's own onMoveChoicesReady for each move's own hop)
  // fixes both cases the same way. Verified directly against resolveParkillerMove: a single roll's
  // Parkiller hop is always capped at the black die's own value (1-6), never a flat worst case.
  it('sequences a roll into its Parkiller hop, first move, and second move with no overlap', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5 // dieA moves this one
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 8 // dieB moves this one - two independent moves this roll
    // dieA=2, dieB=4 (not 3 - 2+3 sums to the exit roll, 5, which with red's other pieces still in
    // the yard would make the exit mandatory and mask the very thing this test means to isolate),
    // blackDie=1 (small, so the Parkiller-hop wait below is easy to distinguish from thinkDelayMs).
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
    vi.advanceTimersByTime(thinkDelayMs) // t=50: the roll fires
    expect(redMoveCount).toBe(0) // still waiting on the Parkiller's own hop (blackDie=1)

    // The Parkiller's own hop: diceSpinMs + blackDie(1)*hopDurationMs = 50 + 100 = 150ms after the
    // roll - the first move can't fire before that finishes.
    vi.advanceTimersByTime(150) // t=200
    expect(redMoveCount).toBe(1)

    // The first move's own hop: dieA(2)*hopDurationMs = 200ms - the second move can't fire before
    // *that* finishes either.
    vi.advanceTimersByTime(200) // t=400
    expect(redMoveCount).toBe(2)

    bots.dispose()
  })

  // Reported directly ("봇이게임할때 말을 이동할차례가되여서 이동시킬때에도 자기 차례를 알리는 효과를
  // 넣어달라" - add the same turn-announcing effect for bot moves too): a human's own choosable
  // piece gets a whole ring/glow/beam indicator; a bot's move used to have no equivalent cue at
  // all. pieceHighlighted should announce the chosen piece as soon as it's decided (not only right
  // before it submits, so the highlight has time to actually read) and clear back to null once the
  // move is actually submitted, handing off to the piece's own hop animation.
  it('announces the piece it has decided to move via pieceHighlighted, then clears it on submit', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5
    const dice = new RecordingDice(new ScriptedDice([2, 4, 1]))
    const inner = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const host = new HostTurnManagerBridge(inner, dice, [red, blue], transport, new Map<number, PieceColor>())
    const thinkDelayMs = 50
    const hopDurationMs = 100
    const diceSpinMs = 50
    const bots = new BotController(host, new Set<PieceColor>(['Red']), thinkDelayMs, hopDurationMs, diceSpinMs)

    const seen: (Piece | null)[] = []
    bots.pieceHighlighted.on((piece) => seen.push(piece))

    host.start()
    vi.advanceTimersByTime(thinkDelayMs) // the roll fires - the Parkiller hop's own busy window starts
    // The bot has already decided which piece to move, well before it actually submits.
    expect(seen).toEqual([red.pieces[0]])

    // Past the Parkiller hop's own budget - the first move now fires and submits, clearing the
    // highlight. (Only one piece is on the track here, so a second die may re-offer the same piece
    // at its new position for a further move right after - this test only cares about the first
    // decide-then-clear cycle, hence checking a prefix rather than the full emission list.)
    vi.advanceTimersByTime(150)
    expect(seen.slice(0, 2)).toEqual([red.pieces[0], null])

    bots.dispose()
  })

  // Reported directly, with the client's own rulebook page ("PAWN ELIMINATES PAWN... BONUS -
  // Choose one: Move one Pawn 20 spaces. / Move one Pawn 10 spaces and another pawn 10 spaces"):
  // both options were already fully implemented and offered (verified directly - turnManager.ts's
  // own offerReward genuinely offers both amounts) but a naive "always pick moves[0]" bot never
  // explored the split, since offerReward lists the full-amount option before the split one - a
  // human watching only bot play would see nothing but "one pawn takes the whole 20," every single
  // time, indistinguishable from the split simply not existing.
  it('prefers the split path over the full amount when a capture grants a reward', () => {
    const board = buildBigTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 3 // dieA(3) lands it on blue.pieces[0] at 6 - a capture
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 0 // in play too, so the split has a genuine second pawn to use
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 6
    const dice = new RecordingDice(new ScriptedDice([3, 4, 1]))
    const inner = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const host = new HostTurnManagerBridge(inner, dice, [red, blue], transport, new Map<number, PieceColor>())
    const thinkDelayMs = 10
    const bots = new BotController(host, new Set<PieceColor>(['Red']), thinkDelayMs, 2, 2)

    host.start()
    vi.advanceTimersByTime(thinkDelayMs) // the roll fires
    vi.advanceTimersByTime(thinkDelayMs) // the capturing move (piece0, dieA=3: 3 -> 6) submits,
    // which queues and immediately offers the capture's own 20-square reward
    expect(red.pieces[0].trackPosition).toBe(6)
    expect(blue.pieces[0].state).toBe('InYard') // confirms the capture actually happened

    vi.advanceTimersByTime(thinkDelayMs) // the reward move fires
    // pieces[0] (the capturing piece itself, still eligible for the reward like any other piece in
    // play) moved by 10 more - 6 -> 16 - not the full 20 from its own position (6 -> 26). Confirms
    // the split path was picked over the lump sum, not just that *some* move happened.
    expect(red.pieces[0].trackPosition).toBe(16)
    expect(red.pieces[1].trackPosition).toBe(0) // untouched by this first half of the split

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
