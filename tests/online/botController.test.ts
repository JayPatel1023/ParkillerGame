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
    const board = buildBigTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 3
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 25 // far enough from piece0 that neither piece's own individual
    // moves below ever cross paths with the other's.
    // Two own-color Blue barriers (BARRIERS page case 1: "two pawns of the same color - any
    // square", not gated on a safe square) block passage through 11 and 33 - exactly the two
    // squares the sum (dieA+dieB=8) would land on for piece0 (3->11) and pass through for piece1
    // (25->33), without touching either piece's own individual-die destinations (5, 9, 27, 31).
    // With the sum illegal for both, this isolates the actual property this test cares about -
    // hop sequencing has no overlap - from item 6's own "prefer the higher single die over the
    // lower one, but never prefer the sum away from a piece that could still use it" preference,
    // which would otherwise make the very first move combine both dice on one piece instead of two
    // separate moves.
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 11
    blue.pieces[1].state = 'OnTrack'
    blue.pieces[1].trackPosition = 11
    blue.pieces[2].state = 'OnTrack'
    blue.pieces[2].trackPosition = 33
    blue.pieces[3].state = 'OnTrack'
    blue.pieces[3].trackPosition = 33
    // dieA=2, dieB=6 (neither is the exit roll 5, and their sum 8 isn't either, so no exit-lock
    // interaction), blackDie=1 (small, so the Parkiller-hop wait below is easy to distinguish from
    // thinkDelayMs).
    const dice = new RecordingDice(new ScriptedDice([2, 6, 1]))
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
    // Item 6's own preference: the sum is illegal for both pieces (blocked above), so the bot
    // prefers whichever single die moves farther - dieB(6) - over dieA(2). piece0 (3) is offered
    // before piece1 (25) on a tie between dieB options, so piece0 takes it: 3 -> 9.
    expect(red.pieces[0].trackPosition).toBe(9)

    // The first move's own hop: dieB(6)*hopDurationMs = 600ms - the second move can't fire before
    // *that* finishes either.
    vi.advanceTimersByTime(400) // t=600
    expect(redMoveCount).toBe(1) // still mid-hop from the first move
    vi.advanceTimersByTime(200) // t=800
    expect(redMoveCount).toBe(2)
    // Only dieA(2) is left. piece0's own dieA(2) from its new position (9 -> 11) is now blocked by
    // the same Blue barrier that ruled out its sum - piece1's dieA(2) (25 -> 27) is the only
    // survivor, so it takes the second move instead.
    expect(red.pieces[1].trackPosition).toBe(27)

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
  //
  // pieces[1] sits at 15, not 0 - an earlier version of this test placed it at 0, Red's own entry
  // square, without noticing that's also a *protected* square: the bot's own separate "keep
  // sheltered pieces sheltered unless the move captures" preference (elsewhere in this same
  // decision) filtered pieces[1]'s own reward-move options out before the split-preference logic
  // below ever saw them, so this test's "genuine second pawn" was never actually a real candidate -
  // it happened to still pass under the old, unconditional split-preference (see this describe
  // block's next test for why that was itself a bug), which masked the setup mistake completely.
  it('prefers the split path over the full amount when a capture grants a reward', () => {
    const board = buildBigTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 3 // dieA(3) lands it on blue.pieces[0] at 6 - a capture
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 15 // in play too, on an unprotected square - a genuine second pawn
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
    expect(red.pieces[1].trackPosition).toBe(15) // untouched by this first half of the split

    // The just-submitted 10-square move itself extends the bot's own busy window by
    // amount*hopDurationMs (10*2=20ms here) before it schedules the next decision - a single
    // thinkDelayMs (10ms) tick isn't enough to clear that on its own.
    vi.advanceTimersByTime(30) // the remaining 10 fires, now offered to pieces[1] alone
    // The split actually completes end to end - the other pawn genuinely receives its own half,
    // not just "some move happened after the first half" (see the next test's own report for why
    // a split that never completes is exactly the bug this whole preference exists to avoid).
    expect(red.pieces[1].trackPosition).toBe(25)

    bots.dispose()
  })

  // Reported directly, with a screen recording ("Había dos peones fuera. Movió uno solo 10... Los
  // otros 10 se perdieron, no movió nadie y pasó el turno" - there were two pawns out, it moved
  // only one 10, the other 10 was lost, nobody moved, and the turn passed): the split-preference
  // above used to fire unconditionally on the reward's own minimum amount, with no check for
  // whether a genuinely different piece could actually use the complementary half - "two pawns
  // out" doesn't mean the *other* one has a legal reward move from wherever it happens to sit.
  // pieces[1] here sits at 37, close enough to its own home entrance (39) that a reward move by
  // either 10 or 20 overshoots past the exact-count landing PC4/PC5 require (verified directly
  // against getValidMoves: neither amount has a legal move for it from 37), so pieces[1] is never
  // a real candidate for anything - the only genuine choice left is between the capturing piece's
  // own 20-in-one or its own 10-split, and picking the split here would just throw away the other
  // 10 for nothing, since nothing else could ever receive it.
  it('takes the full reward amount instead of a wasted split when no other piece can use the remainder', () => {
    const board = buildBigTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 3 // dieA(3) lands it on blue.pieces[0] at 6 - a capture
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 37 // "out," but too close to home (39) for either reward amount
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 6
    const dice = new RecordingDice(new ScriptedDice([3, 4, 1]))
    const inner = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const host = new HostTurnManagerBridge(inner, dice, [red, blue], transport, new Map<number, PieceColor>())
    const thinkDelayMs = 10
    const bots = new BotController(host, new Set<PieceColor>(['Red']), thinkDelayMs, 2, 2)

    let forfeited: { amount: number; reason: string } | null = null
    inner.rewardForfeited.on((grant) => (forfeited = grant))

    host.start()
    vi.advanceTimersByTime(thinkDelayMs) // the roll fires
    vi.advanceTimersByTime(thinkDelayMs) // the capturing move submits, offering the 20-square reward
    vi.advanceTimersByTime(thinkDelayMs) // the reward move fires

    // The full 20 in one move (6 -> 26), not the 10-split that would have nowhere to send its other
    // half - pieces[1] stays exactly where it was, and nothing was ever forfeited.
    expect(red.pieces[0].trackPosition).toBe(26)
    expect(red.pieces[1].trackPosition).toBe(37)
    expect(forfeited).toBeNull()

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

  // Reported directly ("El BOT tenía dos peones para mover y en vez de mover uno y luego otro,
  // siguió con el que iba a caer en la casilla del parki y se suicidó" - the bot had two pawns to
  // move and instead of moving one then the other, it kept going with the one that was going to
  // land on the Parki's square and it committed suicide): landing on an unprotected opposing
  // Parkiller sends the pawn straight home (PK5) with no reward - an avoidable, self-inflicted loss
  // whenever a non-suicidal alternative move exists, same class of mistake the barrier-avoidance
  // heuristic already fixed above.
  it('avoids walking a pawn onto an unprotected opposing Parkiller when a safe move is also available', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5 // dieA(2) lands this one exactly on blue's Parkiller - moves[0]
    // under the old "always pick the first option" behavior (getValidMoves walks pieces in index
    // order, dieA combined into the list before dieB - same ordering the barrier-avoidance test
    // above already relies on).
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 12 // every option for this piece (dieA/dieB/sum) lands somewhere
    // safe/empty - a genuine non-suicidal alternative this roll.
    blue.parkiller.corridorPosition = blue.parkiller.corridorLength
    blue.parkiller.trackPosition = 7 // not a safe square (board's own safeTrackIndices is {0, 10})

    const dice = new RecordingDice(new ScriptedDice([2, 4, 1]))
    const inner = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const host = new HostTurnManagerBridge(inner, dice, [red, blue], transport, new Map<number, PieceColor>())
    const bots = new BotController(host, new Set<PieceColor>(['Red']), 10, 2, 2)

    host.start()
    vi.advanceTimersByTime(10) // the roll fires
    vi.advanceTimersByTime(10) // the first move fires

    // Whichever move actually got picked, piece0 must not have been sent home by walking onto
    // blue's own Parkiller - the one avoidable, self-inflicted "suicide" this roll could produce.
    expect(red.pieces[0].state).not.toBe('InYard')
    expect(blue.parkiller.state).toBe('InPlay') // untouched - not a double, no elimination possible

    bots.dispose()
  })

  // Requested directly ("Debía haber movido incluso todas las casillas con el peón más alejado y
  // quedar a más de 6 casillas del Parki" - it should have moved even all the squares with the
  // farthest pawn and ended up more than 6 squares from the Parki): the black die is 1-6, so a
  // piece left within that range of an opposing Parkiller, on an unprotected square, could be
  // reached on that Parkiller's very next roll - an avoidable risk one step short of
  // wouldWalkIntoUnprotectedParki's own "walking directly onto it" case above, whenever an equally
  // legal move would clear the danger zone entirely.
  it('prefers a move that clears an opposing Parkiller\'s one-roll reach when a safe alternative exists', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5 // dieA(2) lands this one at 7 - within blue's Parkiller's own
    // one-roll reach (distance 3, backward from 10) but not directly on it - moves[0] under the old
    // "always pick the first option" behavior.
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 15 // every option for this piece (dieA/dieB/sum) lands more than
    // 6 squares from blue's Parkiller - a genuinely safe alternative this roll.
    blue.parkiller.corridorPosition = blue.parkiller.corridorLength
    blue.parkiller.trackPosition = 10 // a safe square itself, but that's irrelevant here - only the
    // *destination*'s own safety matters for this heuristic, not the Parkiller's own square.

    const dice = new RecordingDice(new ScriptedDice([2, 4, 1]))
    const inner = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const host = new HostTurnManagerBridge(inner, dice, [red, blue], transport, new Map<number, PieceColor>())
    const bots = new BotController(host, new Set<PieceColor>(['Red']), 10, 2, 2)

    host.start()
    vi.advanceTimersByTime(10) // the roll fires
    vi.advanceTimersByTime(10) // the first move fires

    // Whichever move actually got picked, piece0 must not have landed at 7 - within blue's
    // Parkiller's own next-roll reach - when piece1 had a genuinely safe alternative available.
    const piece0Exposed = red.pieces[0].state === 'OnTrack' && red.pieces[0].trackPosition === 7
    expect(piece0Exposed).toBe(false)

    bots.dispose()
  })

  // Reported directly ("El bot en vez de mover dos peones diferentes, con la suma de los dados
  // 'se suicida el que va en cabeza'" - the bot, instead of moving two different pawns, suicides
  // its lead pawn with the sum of the dice): the sibling test right above only ever covers danger
  // from the opposing Parkiller - this is the same heuristic but for an ordinary opposing pawn,
  // which previously had no equivalent check at all (wouldLeavePieceExposedToPawn's own doc
  // comment covers why). Mirrors that test's own shape exactly, swapping the threat for a plain
  // opposing pawn instead of a Parkiller.
  it('prefers a move that clears an opposing pawn\'s one-roll reach when a safe alternative exists', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5 // dieA(2) lands this one at 7 - within blue.pieces[0]'s own
    // one-roll reach (distance 3, forward from 4) but not directly on it - moves[0] under the old
    // "always pick the first option" behavior.
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 15 // every option for this piece (dieA/dieB/sum) lands more than
    // 6 squares from every blue piece - a genuinely safe alternative this roll.
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 4

    const dice = new RecordingDice(new ScriptedDice([2, 4, 1]))
    const inner = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const host = new HostTurnManagerBridge(inner, dice, [red, blue], transport, new Map<number, PieceColor>())
    const bots = new BotController(host, new Set<PieceColor>(['Red']), 10, 2, 2)

    host.start()
    vi.advanceTimersByTime(10) // the roll fires
    vi.advanceTimersByTime(10) // the first move fires

    // Whichever move actually got picked, piece0 must not have landed at 7 - within blue.pieces[0]'s
    // own next-roll reach - when piece1 had a genuinely safe alternative available.
    const piece0Exposed = red.pieces[0].state === 'OnTrack' && red.pieces[0].trackPosition === 7
    expect(piece0Exposed).toBe(false)

    bots.dispose()
  })

  // Requested directly ("cuando cuente las recompensas idem: debe ver si elimina algún peón en
  // algún salto de 10 o se cae sobre un parki y se queda eliminado" - when counting rewards,
  // likewise: check whether it eliminates a pawn on some 10-jump): a reward move can capture too
  // (PC5 chains a fresh 20 on top) - the split-exploration preference above is purely cosmetic
  // (so a human watching bot play sees the split get used sometimes), while a capture during a
  // reward has real value, so it must win out even though it isn't the "explore the smaller
  // amount" option this test's own sibling above prefers.
  it('prefers a capturing reward move over the split-exploration preference', () => {
    const board = buildBigTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 3 // dieA(3) lands it on blue.pieces[0] at 6 - the triggering capture
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 0 // a second piece, offering a genuine non-capturing 10-split path
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 6
    blue.pieces[1].state = 'OnTrack'
    blue.pieces[1].trackPosition = 26 // exactly 6 + 20 - the reward's own full amount lands here

    const dice = new RecordingDice(new ScriptedDice([3, 4, 1]))
    const inner = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const host = new HostTurnManagerBridge(inner, dice, [red, blue], transport, new Map<number, PieceColor>())
    const thinkDelayMs = 50
    const hopDurationMs = 100
    const diceSpinMs = 50
    const bots = new BotController(host, new Set<PieceColor>(['Red']), thinkDelayMs, hopDurationMs, diceSpinMs)

    host.start()
    vi.advanceTimersByTime(thinkDelayMs) // the roll fires
    vi.advanceTimersByTime(150) // the capturing move (piece0, dieA=3: 3 -> 6) submits, offering the reward
    expect(blue.pieces[0].state).toBe('InYard') // confirms the triggering capture happened

    vi.advanceTimersByTime(thinkDelayMs + hopDurationMs * 20) // the reward move fires (up to 20 squares)

    // The full 20 was taken specifically because it captures blue.pieces[1] - not the 10-split
    // this same scenario's sibling test above would otherwise prefer.
    expect(red.pieces[0].trackPosition).toBe(26)
    expect(blue.pieces[1].state).toBe('InYard')
    expect(red.pieces[1].trackPosition).toBe(0) // untouched - the split was never taken

    bots.dispose()
  })

  // Requested directly ("si algún peón del bot está en una casilla protegida no debería
  // arriesgarse a ser eliminado salvo para eliminar a otro peón. Es mejor que se mueva otro peón" -
  // if a bot's pawn is on a protected square, it shouldn't risk elimination except to capture;
  // better to move a different pawn instead): a piece already sheltered on a protected square
  // gives up that guaranteed safety the moment it leaves - even to a destination the existing
  // Parkiller-exposure checks don't flag as risky at all (this scenario has no opposing Parkiller
  // in play whatsoever, isolating this specific preference from those other two).
  it('leaves a piece on a protected square alone and moves a different piece instead, when both are equally legal', () => {
    const board = buildTestBoard() // safeTrackIndices: {0, 10}
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    blue.parkiller.state = 'Eliminated' // no Parkiller-exposure interaction at all this roll
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0 // sitting on Red's own protected entry square
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 5 // not on a protected square - free to move without giving up
    // any shelter

    // dieA=2, dieB=4 (sum=6) - deliberately not the exit roll (5) either individually or summed,
    // with pieces[2]/[3] still in the yard by default - PC2.1's own exit lock would otherwise
    // override this whole scenario with a mandatory ExitYard-only offer instead.
    const dice = new RecordingDice(new ScriptedDice([2, 4, 1]))
    const inner = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const host = new HostTurnManagerBridge(inner, dice, [red, blue], transport, new Map<number, PieceColor>())
    const bots = new BotController(host, new Set<PieceColor>(['Red']), 10, 2, 2)

    host.start()
    vi.advanceTimersByTime(10) // the roll fires
    vi.advanceTimersByTime(10) // the first move fires

    // piece0 must still be exactly where it started - never moved off its own protected square.
    expect(red.pieces[0].trackPosition).toBe(0)
    // piece1 took the move instead (the sum, 5 -> 11, per item 6's own "prefer the largest legal
    // amount" preference layered on top of this one).
    expect(red.pieces[1].trackPosition).toBe(11)

    bots.dispose()
  })

  // Requested directly ("el bot, si puede eliminar un peón de otro jugador sin riesgo, debe
  // hacerlo" - the bot, if it can eliminate an opponent's pawn without risk, must do so): a
  // capturing move already surviving every risk filter above is exactly a "risk-free" capture in
  // this file's own established sense, but the selection used to have no preference for capturing
  // at all - whichever move happened to sort first won, capture or not.
  it('prefers a risk-free capture over an earlier-sorted non-capturing move', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5 // dieA(2) -> 7, empty and safe, no capture - moves[0] under the
    // old "always pick the first option" behavior (getValidMoves walks pieces in index order, dieA
    // combined into the list before dieB - same ordering the other preference tests above rely on).
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 12 // dieB(4) -> 16, capturing blue.pieces[0] there.
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 16 // not a safe square (board's own safeTrackIndices is {0, 10})

    const dice = new RecordingDice(new ScriptedDice([2, 4, 1]))
    const inner = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const host = new HostTurnManagerBridge(inner, dice, [red, blue], transport, new Map<number, PieceColor>())
    const bots = new BotController(host, new Set<PieceColor>(['Red']), 10, 2, 2)

    host.start()
    vi.advanceTimersByTime(10) // the roll fires
    vi.advanceTimersByTime(10) // the first move fires

    // The risk-free capture must have been taken, not the earlier-sorted non-capturing move.
    expect(blue.pieces[0].state).toBe('InYard')
    expect(red.pieces[1].trackPosition).toBe(16)

    bots.dispose()
  })

  // Reported directly ("El bot debe esperar a que terminen de moverse los peones antes de lanzar
  // los dados del siguiente jugador" - the bot must wait for the pawns to finish moving before
  // rolling the next player's dice): onMoveChoicesReady's own markBusy call only ever ran for this
  // bot's *own* move - a human player's move never extended busyUntilMs at all, so the very next
  // bot's turn could start rolling while a human's own pawn was still visibly mid-hop.
  it("waits out a human player's own move animation before the next bot's turn starts rolling", () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0
    // dieA=3, dieB=4: sum=7 (not 5, no exit obligation in play), spending both dice in one move via
    // the sum - Red's whole turn (a "human" one - Red is deliberately not in botColors below) ends
    // in this single submitMove call, same as a real human's own click would. The second triple is
    // Blue's own bot-triggered roll once its turn starts.
    const dice = new RecordingDice(new ScriptedDice([3, 4, 1, 2, 2, 1]))
    const inner = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const host = new HostTurnManagerBridge(inner, dice, [red, blue], transport, new Map<number, PieceColor>())
    const thinkDelayMs = 10
    const hopDurationMs = 50
    // Only Blue is a bot - Red's move below is submitted directly against `inner`, the same way a
    // real human's own click reaches the underlying TurnManager, never through submitMoveForBot.
    const bots = new BotController(host, new Set<PieceColor>(['Blue']), thinkDelayMs, hopDurationMs, 2)

    let rollCount = 0
    inner.diceRolled.on(() => rollCount++)

    host.start()
    inner.requestRoll() // Red's own "human" roll
    expect(rollCount).toBe(1)
    inner.submitMove(red.pieces[0], 7) // 0 -> 7, spends the sum, ends Red's turn - Blue's turn starts
    expect(host.currentPlayer.color).toBe('Blue')

    // Blue is a bot with only a thinkDelayMs of 10ms - without the fix, its roll would already have
    // fired by now, since nothing extended busyUntilMs for Red's own 7-square move.
    vi.advanceTimersByTime(thinkDelayMs)
    expect(rollCount).toBe(1) // still just Red's roll - Blue is correctly still waiting

    // Just short of the full 7*hopDurationMs=350ms Red's own move needs to finish hopping.
    vi.advanceTimersByTime(300)
    expect(rollCount).toBe(1)

    // Past it now - Blue's roll should fire.
    vi.advanceTimersByTime(60)
    expect(rollCount).toBe(2)

    bots.dispose()
  })

  // Requested directly ("로컬 게임에는 Pause 기능을 넣어라" - add a Pause feature to local games):
  // pause() must cancel whatever this bot currently has scheduled (here, its very first roll,
  // still mid-think-delay) so it genuinely stops acting - not just visually, the way a UI-only
  // overlay would - and resume() must eventually replay that exact same action rather than the bot
  // going silent for the rest of the game.
  it('pause() cancels a bot\'s pending action and resume() eventually replays it', () => {
    const board = buildTestBoard()
    const players = [createPlayerState('Red', board), createPlayerState('Blue', board)]
    const dice = new RecordingDice()
    const inner = new TurnManager(board, players, defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const host = new HostTurnManagerBridge(inner, dice, players, transport, new Map<number, PieceColor>())
    const thinkDelayMs = 50
    const bots = new BotController(host, new Set<PieceColor>(['Red', 'Blue']), thinkDelayMs, 2, 2)

    let rollCount = 0
    inner.diceRolled.on(() => rollCount++)

    host.start()
    vi.advanceTimersByTime(20) // well short of thinkDelayMs - the roll hasn't fired yet
    expect(rollCount).toBe(0)

    bots.pause()
    // Well past when the original think-delay would have elapsed, had it not been cancelled.
    vi.advanceTimersByTime(200)
    expect(rollCount).toBe(0) // still nothing - a real pause, not merely a UI overlay on top of it

    bots.resume()
    expect(rollCount).toBe(0) // resume itself doesn't act instantly - it re-arms a fresh think-delay
    vi.advanceTimersByTime(thinkDelayMs)
    expect(rollCount).toBe(1) // the same originally-scheduled roll finally goes through

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
