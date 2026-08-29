import { describe, expect, it } from 'vitest'
import type { BoardData } from '../src/core/board/boardData'
import type { DiceLike } from '../src/core/dice'
import { createPlayerState } from '../src/core/gameFlow/playerState'
import { TurnManager, type ParkillerMoveResult, type RewardGrant } from '../src/core/gameFlow/turnManager'
import { createParkiller } from '../src/core/pieces/parkiller'
import { defaultRuleSettings } from '../src/core/rules/ruleSettings'
import type { MoveOption } from '../src/core/rules/moveOption'

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

function buildTestBoard(): BoardData {
  return {
    playerCount: 2,
    trackLength: 20,
    lanes: {
      Red: { color: 'Red', entryTrackIndex: 0, homeEntranceTrackIndex: 19, corridorLength: 6 },
      Blue: { color: 'Blue', entryTrackIndex: 10, homeEntranceTrackIndex: 9, corridorLength: 6 },
    },
    safeTrackIndices: new Set([0, 10, 15]),
  }
}

describe('createParkiller', () => {
  it('starts InPlay at the given home-entrance track index, not yet having crossed its own corridor', () => {
    expect(createParkiller('Red', 19, 6)).toEqual({ color: 'Red', state: 'InPlay', trackPosition: 19, corridorPosition: 0, corridorLength: 6, arrivedAt: 0 })
  })
})

// Most of these tests are about capture/collision mechanics once the Parkiller is already on the
// shared track, not about the corridor-crossing mechanic itself (see the dedicated describe block
// below for that) - corridorPosition is pushed to corridorLength up front so a small scripted black
// die still reaches the track, matching what these tests were already asserting before
// corridorPosition existed at all. Any opposing Parkiller referenced by trackPosition also needs
// this, or isParkillerOnTrack (parchisRules.ts) treats it as still-in-corridor and un-interactable.
describe('TurnManager - Parkiller (PK 1-8)', () => {
  it('moves backward (decreasing track index) by the black die each roll', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.parkiller.corridorPosition = red.parkiller.corridorLength

    const dice = new ScriptedDice([1, 1, 3]) // dieA=1, dieB=1 (no legal move exists), blackDie=3
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let result: ParkillerMoveResult | null = null
    manager.parkillerMoved.on((r) => (result = r))

    manager.requestRoll()

    expect(result).toEqual({
      color: 'Red',
      before: 19,
      after: 16,
      beforeCorridorPosition: 6,
      afterCorridorPosition: 6,
      capturedPawn: null,
      capturedParkillerColor: null,
      secondCapturedParkillerColor: null,
    })
    expect(red.parkiller.trackPosition).toBe(16)
  })

  it('captures an opposing pawn it lands on, with no reward to the mover', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.parkiller.corridorPosition = red.parkiller.corridorLength
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 16 // Red's parkiller (starts at 19) lands here with blackDie=3

    const dice = new ScriptedDice([1, 1, 3])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let result: ParkillerMoveResult | null = null
    manager.parkillerMoved.on((r) => (result = r))
    let rewardOffered = false
    manager.rewardOffered.on(() => (rewardOffered = true))

    manager.requestRoll()

    expect(result).toEqual({
      color: 'Red',
      before: 19,
      after: 16,
      beforeCorridorPosition: 6,
      afterCorridorPosition: 6,
      capturedPawn: blue.pieces[0],
      capturedParkillerColor: null,
      secondCapturedParkillerColor: null,
    })
    expect(blue.pieces[0].state).toBe('InYard')
    expect(blue.pieces[0].trackPosition).toBe(-1)
    expect(rewardOffered).toBe(false)
  })

  it('landing on a barrier (2 pawns) eliminates only the one that does not share its own color (PK5/PK10)', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.parkiller.corridorPosition = red.parkiller.corridorLength
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 16
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 16 // barrier: Red's own pawn + Blue's, on Red's Parkiller's path

    const dice = new ScriptedDice([1, 1, 3]) // Red's parkiller: 19 -> 16
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let result: ParkillerMoveResult | null = null
    manager.parkillerMoved.on((r) => (result = r))

    manager.requestRoll()

    expect(result).toEqual({
      color: 'Red',
      before: 19,
      after: 16,
      beforeCorridorPosition: 6,
      afterCorridorPosition: 6,
      capturedPawn: blue.pieces[0],
      capturedParkillerColor: null,
      secondCapturedParkillerColor: null,
    })
    expect(blue.pieces[0].state).toBe('InYard')
    // Red's own pawn is protected by sharing the Parkiller's color - stays right where it was.
    expect(red.pieces[0].state).toBe('OnTrack')
    expect(red.pieces[0].trackPosition).toBe(16)
  })

  // Reported directly, with a screenshot: 3 pieces (a Parkiller + a 2-pawn barrier) all shown
  // sitting on the same square at once. Root-caused to resolveParkillerCollisions gating its whole
  // elimination check on the square being unprotected - correct for a *lone* pawn (PK4/PK5: they
  // simply form a barrier, see the test above/below), but wrong for an already-formed 2-pawn
  // barrier the Parkiller then lands on top of, which PK5/PK10 describe as always resolving to one
  // elimination with no protected-square exception (verified against the reference
  // implementation's own ingresaFicha(), whose very first check is unconditional on the square's
  // own protected flag).
  it('landing on a barrier (2 pawns) on a protected square still eliminates one, not a 3-way coexistence', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.parkiller.corridorPosition = red.parkiller.corridorLength
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 15 // a safe square, reachable with blackDie=4 from Red's start (19)
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 15 // barrier: Red's own pawn + Blue's, both on the safe square

    const dice = new ScriptedDice([1, 1, 4])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    manager.requestRoll()

    expect(blue.pieces[0].state).toBe('InYard')
    // Red's own pawn is protected by sharing the Parkiller's color - stays right where it was.
    expect(red.pieces[0].state).toBe('OnTrack')
    expect(red.pieces[0].trackPosition).toBe(15)
    // Exactly 2 occupants remain on the square (Red's pawn + the arriving Parkiller), never 3.
    expect(red.parkiller.trackPosition).toBe(15)
  })

  // Reported directly ("Debe dejarme mover también alguno de los peones que forman la barrera...
  // no puede ser"), then reproduced via a randomized stress test: PK5/PK10's "landing on an
  // existing barrier always eliminates exactly one" describes the Parkiller landing on an
  // *opposing or mixed* barrier - resolveBarrierElimination's tie-break (arrival order, once
  // color alone doesn't decide it) was only ever meant to settle which of two same-*third*-color
  // pieces goes. It didn't check whether that shared color was the *mover's own* - a Parkiller
  // landing on its own player's already-formed 2-pawn barrier hit that same tie-break and wiped
  // one of the mover's own pawns for no in-game reason at all, an own-color self-elimination the
  // rulebook has no mechanic for. The correct read (BARRIERS page case 3, "a Parkiller and a pawn
  // of its own color - any space") is that the Parkiller just joins its own family peacefully,
  // same as the ordinary lone-own-pawn case.
  it('a Parkiller landing on its own player\'s existing 2-pawn barrier joins peacefully, eliminating neither', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 16
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 16 // own barrier: two Red pawns, not a safe square
    red.parkiller.corridorPosition = red.parkiller.corridorLength
    red.parkiller.trackPosition = 19 // Red's own Parkiller start, reaches 16 with blackDie=3

    const dice = new ScriptedDice([1, 1, 3])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    manager.requestRoll()

    expect(red.parkiller.trackPosition).toBe(16)
    expect(red.parkiller.state).toBe('InPlay')
    expect(red.pieces[0].state).toBe('OnTrack')
    expect(red.pieces[0].trackPosition).toBe(16)
    expect(red.pieces[1].state).toBe('OnTrack')
    expect(red.pieces[1].trackPosition).toBe(16)
  })

  it('does not capture a pawn sitting on a protected square', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.parkiller.corridorPosition = red.parkiller.corridorLength
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 15 // a safe square, reachable with blackDie=4 from Red's start (19)

    const dice = new ScriptedDice([1, 1, 4])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    manager.requestRoll()

    expect(blue.pieces[0].state).toBe('OnTrack')
    expect(blue.pieces[0].trackPosition).toBe(15)
  })

  it('landing on an opposing Parkiller eliminates it and offers a reward ahead of the white dice', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.parkiller.corridorPosition = red.parkiller.corridorLength
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0 // needs a piece already in play to spend the reward on (PC 5)
    blue.parkiller.corridorPosition = blue.parkiller.corridorLength
    // 16, not a safe square (board's own safeTrackIndices is {0, 10, 15}) - landing on a *safe*
    // square instead forms a barrier now (see the sibling test just below), doesn't eliminate.
    blue.parkiller.trackPosition = 16 // reachable from Red's parkiller start (19) with blackDie=3

    const dice = new ScriptedDice([1, 1, 3])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    const grants: RewardGrant[] = []
    manager.rewardOffered.on((g) => grants.push(g))
    let latestMoves: MoveOption[] = []
    manager.moveChoicesReady.on((m) => (latestMoves = m))

    manager.requestRoll()

    expect(blue.parkiller.state).toBe('Eliminated')
    // one 20-square grant, offered as a choice between one pawn moving 20 or two pawns moving 10 each
    expect(grants).toEqual([{ amount: 20, reason: 'capture' }])
    expect(latestMoves.length).toBeGreaterThan(0)
    expect(latestMoves.every((m) => m.diceSource === 'reward')).toBe(true)
    expect(latestMoves.some((m) => m.amount === 20)).toBe(true)
    expect(latestMoves.some((m) => m.amount === 10)).toBe(true)
  })

  // Client's own "BARRIERS" rules page, case 4: "Two Parkis - can only be formed on a safe space."
  // This used to unconditionally eliminate the opposing Parkiller regardless of the square's own
  // safety, the one pairing on that page missing the safe-square exception every other pairing
  // (two pawns, a Parki + a same-color pawn, a Parki + a different-color pawn) already gets.
  it('landing on an opposing Parkiller on a *safe* square forms a barrier instead of eliminating it', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.parkiller.corridorPosition = red.parkiller.corridorLength
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0
    blue.parkiller.corridorPosition = blue.parkiller.corridorLength
    blue.parkiller.trackPosition = 15 // a safe square (board's own safeTrackIndices)

    const dice = new ScriptedDice([1, 1, 4]) // blackDie=4 walks red's own parkiller 19 -> 15
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    const grants: RewardGrant[] = []
    manager.rewardOffered.on((g) => grants.push(g))

    manager.requestRoll()

    expect(red.parkiller.trackPosition).toBe(15)
    expect(blue.parkiller.state).toBe('InPlay')
    expect(blue.parkiller.trackPosition).toBe(15)
    expect(grants).toEqual([]) // no elimination, no PK7 reward either
  })

  // Client's own "Special Situations" guide, "PARKI REMOVES TWO PARKIS": a third Parki landing on
  // two already-paired opposing Parkis (only possible on a safe square, per the sibling test just
  // above) eliminates both, not just one - the general "landing on a barrier always eliminates
  // exactly one" rule (PK5/PK10) has this one documented exception.
  it('landing on two already-paired opposing Parkillers eliminates both of them', () => {
    // A bigger board than buildTestBoard's (trackLength 20 is too tight - a lone piece's first
    // 20-square reward would push it straight into its home corridor, past the point either
    // reward could still be spent, forfeiting the second one for a reason unrelated to this rule).
    const board: BoardData = {
      playerCount: 2,
      trackLength: 40,
      lanes: {
        Red: { color: 'Red', entryTrackIndex: 0, homeEntranceTrackIndex: 39, corridorLength: 6 },
        Blue: { color: 'Blue', entryTrackIndex: 20, homeEntranceTrackIndex: 19, corridorLength: 6 },
      },
      safeTrackIndices: new Set([0, 20]),
    }
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    const green = createPlayerState('Green', board)
    red.parkiller.corridorPosition = red.parkiller.corridorLength
    red.parkiller.trackPosition = 24 // blackDie=4 below walks it 24 -> 20
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0 // spends the first reward
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 5 // spends the second reward
    blue.parkiller.corridorPosition = blue.parkiller.corridorLength
    blue.parkiller.trackPosition = 20 // a safe square
    green.parkiller.corridorPosition = green.parkiller.corridorLength
    green.parkiller.trackPosition = 20 // paired with blue's, forming a "Two Parkis" barrier

    const dice = new ScriptedDice([1, 1, 4])
    const manager = new TurnManager(board, [red, blue, green], defaultRuleSettings(), dice)

    const grants: RewardGrant[] = []
    manager.rewardOffered.on((g) => grants.push(g))
    const parkillerResults: ParkillerMoveResult[] = []
    manager.parkillerMoved.on((r) => parkillerResults.push(r))

    manager.requestRoll()

    expect(red.parkiller.trackPosition).toBe(20)
    expect(blue.parkiller.state).toBe('Eliminated')
    expect(green.parkiller.state).toBe('Eliminated')
    expect(parkillerResults[0]?.capturedParkillerColor).toBe('Blue')
    expect(parkillerResults[0]?.secondCapturedParkillerColor).toBe('Green')
    // The first of the two 20-square rewards is offered right away - the second grant stays
    // queued (offerNextReward's own one-grant-at-a-time draining) until this one is spent.
    expect(grants).toEqual([{ amount: 20, reason: 'capture' }])

    manager.submitMove(red.pieces[0], 20) // 0 -> 20, spends the first reward in full

    // Spending the first grant drains the queue straight to the second one, offered the same way.
    expect(grants).toEqual([
      { amount: 20, reason: 'capture' },
      { amount: 20, reason: 'capture' },
    ])

    // Only the 10-square split is still open for pieces[1] here - red's own Parkiller stayed
    // parked at 20 (Parkillers don't move via these two white dice), so pieces[0] joining it
    // there for the first reward formed a genuine own barrier (Parkiller + pawn) that blocks any
    // path crossing square 20, pieces[1]'s own full-20 destination (5 -> 25) included.
    manager.submitMove(red.pieces[1], 10) // 5 -> 15, spends the second reward's split half
    expect(red.pieces[1].trackPosition).toBe(15)
  })

  it('a pawn move landing on an opposing Parkiller during a doubles roll eliminates it and grants a reward', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0
    blue.parkiller.corridorPosition = blue.parkiller.corridorLength
    blue.parkiller.trackPosition = 5

    // PK6/PK8: verified directly against the reference implementation's doblete_mata_parkiller
    // flag - a common piece only eliminates the Parkiller during the roll that produced doubles.
    const dice = new ScriptedDice([5, 5, 1]) // dieA=dieB=5 (double) moves red.pieces[0] 0 -> 5, onto blue's parkiller
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    const grants: RewardGrant[] = []
    manager.rewardOffered.on((g) => grants.push(g))

    manager.requestRoll()
    const result = manager.submitMove(red.pieces[0])

    expect(result?.capturedParkillerColor).toBe('Blue')
    expect(blue.parkiller.state).toBe('Eliminated')
    expect(grants).toEqual([{ amount: 20, reason: 'capture' }])
  })

  // Relayed directly from the client, describing the full sequence he expects around a
  // double-triggered Parkiller kill: eliminate with a single die -> spend the 20-square reward ->
  // spend whatever's left of the double's own dice -> roll again (it was a double). Each link was
  // already implemented separately (this test's own siblings cover the elimination+reward and the
  // "a reward capture chains a fresh reward" case in tests/turnManager.test.ts) except one specific
  // combination that had no coverage anywhere: a *reward* move (not a die move) landing on a
  // *different* opposing Parkiller. PK6's own single-die requirement (see applyMove's usesSingleDie)
  // means a reward move can never eliminate a Parkiller the way the original die move just did -
  // PK5 applies instead, same as any other pawn move that isn't the doubles-producing single die.
  it('resolves a full double-triggered Parkiller-kill chain: reward move bounces off a second Parkiller (PK5, not PK6), remaining die still spends, bonus turn follows', () => {
    const board: BoardData = {
      playerCount: 3,
      trackLength: 40,
      lanes: {
        Red: { color: 'Red', entryTrackIndex: 0, homeEntranceTrackIndex: 39, corridorLength: 6 },
        Blue: { color: 'Blue', entryTrackIndex: 20, homeEntranceTrackIndex: 19, corridorLength: 6 },
      },
      safeTrackIndices: new Set([0, 20]),
    }
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    const green = createPlayerState('Green', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 1 // spends the double's remaining die once the reward chain resolves
    blue.parkiller.corridorPosition = blue.parkiller.corridorLength
    blue.parkiller.trackPosition = 3 // reachable from red.pieces[0] (0) with a single die of 3
    green.parkiller.corridorPosition = green.parkiller.corridorLength
    green.parkiller.trackPosition = 23 // exactly where the 20-square reward lands (3 + 20), unprotected

    // A double worth 3, not 5 (this board's own exitRoll) - deliberately avoids PC2.1's own die-
    // locked-to-exit mechanic (already covered by its own dedicated tests), which would otherwise
    // exclude pieces[1]'s plain, non-capturing move below the moment any yard piece could also use
    // that same die's value to exit.
    const dice = new ScriptedDice([3, 3, 1, /* bonus turn */ 2, 4, 9])
    const manager = new TurnManager(board, [red, blue, green], defaultRuleSettings(), dice)

    const grants: RewardGrant[] = []
    manager.rewardOffered.on((g) => grants.push(g))
    let latestMoves: MoveOption[] = []
    manager.moveChoicesReady.on((m) => (latestMoves = m))

    manager.requestRoll()

    // Spends one of the double's two dice (both worth 3) to walk red.pieces[0] onto blue's
    // Parkiller - PK6 lets a single die eliminate it since this is the doubles-producing roll.
    const captureResult = manager.submitMove(red.pieces[0])
    expect(captureResult?.capturedParkillerColor).toBe('Blue')
    expect(blue.parkiller.state).toBe('Eliminated')
    expect(grants).toEqual([{ amount: 20, reason: 'capture' }])

    // Takes the full 20 in one go, landing red.pieces[0] (now at 3) straight on green's Parkiller.
    manager.submitMove(red.pieces[0], 20)

    // PK6 doesn't apply to a reward move (not a single die) - green's Parkiller survives, and PK5
    // sends the arriving pawn home instead, with no further reward queued from this bounce.
    expect(green.parkiller.state).toBe('InPlay')
    expect(red.pieces[0].state).toBe('InYard')
    expect(red.pieces[0].trackPosition).toBe(-1)
    expect(grants).toEqual([{ amount: 20, reason: 'capture' }]) // unchanged - no new grant from the bounce

    // The reward chain is done, but the double's other die (also a 3) is still unspent.
    expect(latestMoves.length).toBeGreaterThan(0)
    expect(latestMoves.every((m) => m.diceSource !== 'reward')).toBe(true)

    manager.submitMove(red.pieces[1])
    expect(red.pieces[1].trackPosition).toBe(4)

    // Both dice spent, and the roll that produced all of this was itself a double - same player
    // rolls again rather than the turn passing to blue.
    manager.requestRoll()
    expect(manager.currentPlayer.color).toBe('Red')
  })

  it('never emits parkillerMoved for a roll once the current player\'s own Parkiller is eliminated (PK6)', () => {
    // Reproduces a real client-reported freeze: once a Parkiller is Eliminated, BoardScene never
    // mounts a mesh for it again (getParkillerWaypoint returns null for it), so nothing would ever
    // call back to clear the animation this event requests - useTurnManager set parkillerAnimation
    // from it unconditionally regardless, permanently disabling the roll button from the very next
    // roll onward. There's nothing to animate for a dead Parkiller, so the event must not fire at
    // all - not fire with a same-position noop result the way a live Parkiller's skipped/bonus-turn
    // roll correctly does (see the 'moves backward' test above and noopParkillerResult).
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.parkiller.state = 'Eliminated'
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0

    const dice = new ScriptedDice([2, 3, 4]) // blackDie=4 would move a live Parkiller - must be ignored entirely
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let parkillerEventFired = false
    manager.parkillerMoved.on(() => (parkillerEventFired = true))
    let latestMoves: MoveOption[] = []
    manager.moveChoicesReady.on((m) => (latestMoves = m))

    manager.requestRoll()

    expect(parkillerEventFired).toBe(false)
    // Turn flow itself must still proceed normally - not get stuck waiting on an animation that
    // will now never even start.
    expect(latestMoves.length).toBeGreaterThan(0)
  })

  it('an opposing Parkiller guarding the exit sends a mandatorily-exiting pawn straight back to the yard (PK5)', () => {
    // Unlike buildTestBoard() above, Red's own entry square (0) is deliberately NOT a safe square
    // here - matching real generated board data, where an entry square is frequently unprotected
    // (e.g. every entry on the 4-player board). Reported directly: a pawn forced to exit onto a
    // square an opposing Parkiller happened to be sitting on came back eliminated, wasting the
    // roll - this is that exact scenario end to end, not just the underlying rule in isolation.
    const board: BoardData = {
      playerCount: 2,
      trackLength: 20,
      lanes: {
        Red: { color: 'Red', entryTrackIndex: 0, homeEntranceTrackIndex: 19, corridorLength: 6 },
        Blue: { color: 'Blue', entryTrackIndex: 10, homeEntranceTrackIndex: 9, corridorLength: 6 },
      },
      safeTrackIndices: new Set([10]),
    }
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    blue.parkiller.corridorPosition = blue.parkiller.corridorLength
    blue.parkiller.trackPosition = 0 // sitting right on Red's own exit

    const dice = new ScriptedDice([5, 2, 1]) // dieA=5 exits a yard piece onto position 0
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    manager.requestRoll()
    const result = manager.submitMove(red.pieces[0])

    expect(result?.eliminatedByParkiller).toBe(true)
    expect(red.pieces[0].state).toBe('InYard')
    expect(blue.parkiller.state).toBe('InPlay') // the Parkiller itself is unharmed
  })

  // Client's own "Special Situations" guide, "PARKI ON THE STARTING SQUARE": a foreign Parkiller
  // already paired with a pawn of its *own* color on the entry square is a real, protected barrier
  // (BARRIERS page, case 2's own opposing-pawn logic extended to a Parkiller) - a single 5 has
  // *no* legal exit for it at all, exactly like any other barrier a non-double roll can't open.
  describe('a foreign Parkiller paired with a pawn of its own color on the entry square (client\'s guide, page 2-3)', () => {
    function buildBoard(): BoardData {
      return {
        playerCount: 2,
        trackLength: 40,
        lanes: {
          Red: { color: 'Red', entryTrackIndex: 0, homeEntranceTrackIndex: 2, corridorLength: 2 },
          Blue: { color: 'Blue', entryTrackIndex: 20, homeEntranceTrackIndex: 19, corridorLength: 6 },
        },
        safeTrackIndices: new Set([0, 20]),
      }
    }

    it('single 5: no legal exit at all - the pairing is fully protected', () => {
      const board = buildBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      blue.parkiller.corridorPosition = blue.parkiller.corridorLength
      blue.parkiller.trackPosition = 0
      blue.pieces[0].state = 'OnTrack'
      blue.pieces[0].trackPosition = 0

      const dice = new ScriptedDice([5, 2, 1])
      const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)
      let latestMoves: MoveOption[] = []
      manager.moveChoicesReady.on((m) => (latestMoves = m))

      manager.requestRoll()

      expect(latestMoves.some((m) => m.kind === 'ExitYard')).toBe(false)
      expect(red.pieces[0].state).toBe('InYard')
    })

    it('double 5, only one shelter pawn: eliminates the pawn only - the Parkiller survives', () => {
      const board = buildBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      blue.parkiller.corridorPosition = blue.parkiller.corridorLength
      blue.parkiller.trackPosition = 0
      blue.pieces[0].state = 'OnTrack'
      blue.pieces[0].trackPosition = 0
      red.pieces[1].state = 'Finished'
      red.pieces[2].state = 'Finished'
      red.pieces[3].state = 'Finished'

      const dice = new ScriptedDice([5, 5, 1])
      const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

      manager.requestRoll()
      const result = manager.submitMove(red.pieces[0])

      expect(result?.capturedPiece).toBe(blue.pieces[0])
      expect(result?.capturedParkillerColor).toBeFalsy()
      expect(blue.pieces[0].state).toBe('InYard')
      expect(blue.parkiller.state).toBe('InPlay')
      expect(red.pieces[0].state).toBe('OnTrack')
      expect(red.pieces[0].trackPosition).toBe(0)
    })

    it('double 5, two shelter pawns: the first exit eliminates the pawn, the second eliminates the Parkiller too', () => {
      const board = buildBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      blue.parkiller.corridorPosition = blue.parkiller.corridorLength
      blue.parkiller.trackPosition = 0
      blue.pieces[0].state = 'OnTrack'
      blue.pieces[0].trackPosition = 0

      const dice = new ScriptedDice([5, 5, 1])
      const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)
      let latestMoves: MoveOption[] = []
      manager.moveChoicesReady.on((m) => (latestMoves = m))

      manager.requestRoll()
      const r1 = manager.submitMove(red.pieces[0])

      expect(r1?.capturedPiece).toBe(blue.pieces[0])
      expect(r1?.capturedParkillerColor).toBeFalsy()
      expect(blue.parkiller.state).toBe('InPlay') // not yet - only the first exit has happened

      const secondExit = latestMoves.find((m) => m.kind === 'ExitYard')
      expect(secondExit).toBeTruthy()
      const r2 = manager.submitMove(secondExit!.piece)

      expect(r2?.capturedParkillerColor).toBe('Blue')
      expect(blue.parkiller.state).toBe('Eliminated')
      expect(red.pieces[0].state).toBe('OnTrack')
      expect(red.pieces[0].trackPosition).toBe(0)
      expect(secondExit!.piece.state).toBe('OnTrack')
      expect(secondExit!.piece.trackPosition).toBe(0)
    })
  })

  // Client's own "Special Situations" guide, page 4: a foreign Parkiller already paired with a
  // *third* player's pawn (neither matching the exiting player's own color) is never protected the
  // way a same-color pairing is - a single 5 already eliminates the pawn (parchisRules.test.ts
  // covers that in isolation); this locks in the double-5 case end to end, where PK6's own
  // existing "single die during a double" window happens to eliminate the Parkiller on the very
  // same first exit - "double 5 removes both the pawn and the Parki" holds regardless of whether
  // one or two shelter pawns are available (the client's own text draws no such distinction here,
  // unlike the same-color pairing above).
  it('double 5, foreign Parkiller paired with a third player\'s pawn: removes both on the very first exit', () => {
    const board: BoardData = {
      playerCount: 2,
      trackLength: 40,
      lanes: {
        Red: { color: 'Red', entryTrackIndex: 0, homeEntranceTrackIndex: 2, corridorLength: 2 },
        Blue: { color: 'Blue', entryTrackIndex: 20, homeEntranceTrackIndex: 19, corridorLength: 6 },
      },
      safeTrackIndices: new Set([0, 20]),
    }
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    const green = createPlayerState('Green', board)
    green.parkiller.state = 'Eliminated' // no lane defined for Green on this board - out of the way entirely
    blue.parkiller.corridorPosition = blue.parkiller.corridorLength
    blue.parkiller.trackPosition = 0
    green.pieces[0].state = 'OnTrack'
    green.pieces[0].trackPosition = 0

    const dice = new ScriptedDice([5, 5, 1])
    const manager = new TurnManager(board, [red, blue, green], defaultRuleSettings(), dice)

    manager.requestRoll()
    const result = manager.submitMove(red.pieces[0])

    expect(result?.capturedPiece).toBe(green.pieces[0])
    expect(result?.capturedParkillerColor).toBe('Blue')
    expect(green.pieces[0].state).toBe('InYard')
    expect(blue.parkiller.state).toBe('Eliminated')
    expect(red.pieces[0].state).toBe('OnTrack')
    expect(red.pieces[0].trackPosition).toBe(0)
  })

  // Client's own "Special Situations" guide, page 5 case 2: two Parkis already paired on the
  // entry square, one the shelter's own color, double 5, two shelter pawns - the first exit
  // eliminates the foreign Parkiller (joining its own), the second has nowhere to go (the square
  // is full again with this pawn + red's own Parkiller) and stays blocked. Already correctly
  // handled by existing machinery (ownOnEntry's own >=2 re-evaluation, fresh on every offerMoves()
  // call) - this locks in the full end-to-end sequence, not just the single exit's own resolution
  // (parchisRules.test.ts's sibling test covers that in isolation).
  it('double 5, two Parkis (one the shelter\'s own) on the entry square, two shelter pawns: first exit eliminates the foreign Parkiller, second stays blocked (own barrier re-forms)', () => {
    const board: BoardData = {
      playerCount: 2,
      trackLength: 40,
      lanes: {
        Red: { color: 'Red', entryTrackIndex: 0, homeEntranceTrackIndex: 2, corridorLength: 2 },
        Blue: { color: 'Blue', entryTrackIndex: 20, homeEntranceTrackIndex: 19, corridorLength: 6 },
      },
      safeTrackIndices: new Set([0, 20]),
    }
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    const blackDie = 3
    red.parkiller.corridorPosition = red.parkiller.corridorLength
    red.parkiller.trackPosition = (0 + blackDie) % board.trackLength // lands exactly on 0 this roll
    blue.parkiller.corridorPosition = blue.parkiller.corridorLength
    blue.parkiller.trackPosition = 0

    const dice = new ScriptedDice([5, 5, blackDie])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)
    let notPossibleReason: string | null = null
    manager.moveNotPossible.on((r) => (notPossibleReason = r))
    let turnStartedAgainFor: string | null = null
    manager.turnStarted.on((p) => (turnStartedAgainFor = p.color))

    manager.requestRoll()
    expect(red.parkiller.trackPosition).toBe(0) // own Parkiller's black-die move landed it here first

    const result = manager.submitMove(red.pieces[0])

    expect(result?.capturedParkillerColor).toBe('Blue')
    expect(blue.parkiller.state).toBe('Eliminated')
    expect(red.parkiller.state).toBe('InPlay') // pawns cannot eliminate their own Parki
    expect(red.pieces[0].state).toBe('OnTrack')
    expect(red.pieces[0].trackPosition).toBe(0)
    // The second shelter pawn has nowhere to go - the square is full again (this pawn + red's own
    // Parkiller) - the remaining die simply has nothing to spend, and since this was a double, the
    // same player rolls again rather than the turn passing on.
    expect(notPossibleReason).toBe('none')
    expect(turnStartedAgainFor).toBe('Red')
    expect(red.pieces[1].state).toBe('InYard')
  })

  // Client's own "Special Situations" guide, page 6 case 2: this time the shelter owner's own
  // Parkiller is genuinely alone on the entry square - no foreign Parkiller involved at all, unlike
  // the sibling test just above. Double 5, two shelter pawns - the first pawn simply joins its own
  // Parkiller peacefully (no capture, nothing foreign there to eliminate), and the second pawn then
  // has nowhere to go (the square is already full with the first pawn + the own Parkiller) and
  // stays blocked in the shelter, same underlying mechanism as the sibling test.
  it('double 5, own Parkiller genuinely alone (no foreign Parkiller) on the entry square, two shelter pawns: first pawn joins peacefully, second stays blocked', () => {
    const board: BoardData = {
      playerCount: 2,
      trackLength: 40,
      lanes: {
        Red: { color: 'Red', entryTrackIndex: 0, homeEntranceTrackIndex: 2, corridorLength: 2 },
        Blue: { color: 'Blue', entryTrackIndex: 20, homeEntranceTrackIndex: 19, corridorLength: 6 },
      },
      safeTrackIndices: new Set([0, 20]),
    }
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    const blackDie = 3
    red.parkiller.corridorPosition = red.parkiller.corridorLength
    red.parkiller.trackPosition = (0 + blackDie) % board.trackLength // lands exactly on 0 this roll
    // Blue's Parkiller is deliberately not on this square at all - genuinely alone.

    const dice = new ScriptedDice([5, 5, blackDie])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)
    let notPossibleReason: string | null = null
    manager.moveNotPossible.on((r) => (notPossibleReason = r))
    let turnStartedAgainFor: string | null = null
    manager.turnStarted.on((p) => (turnStartedAgainFor = p.color))

    manager.requestRoll()
    expect(red.parkiller.trackPosition).toBe(0)

    const result = manager.submitMove(red.pieces[0])

    expect(result?.capturedPiece).toBeNull()
    expect(result?.capturedParkillerColor).toBeFalsy()
    expect(red.pieces[0].state).toBe('OnTrack')
    expect(red.pieces[0].trackPosition).toBe(0)
    expect(red.parkiller.state).toBe('InPlay')
    // The second shelter pawn has nowhere to go - blocked the same way the sibling test's does.
    expect(notPossibleReason).toBe('none')
    expect(turnStartedAgainFor).toBe('Red')
    expect(red.pieces[1].state).toBe('InYard')
  })

  // Client's own "Special Situations" guide, page 7: two Parkis already paired on the entry
  // square, neither belonging to the shelter owner, are never a protected pairing (only a
  // same-color pair is - getValidMoves' own foreignBarrier agrees, two different colors never
  // block this exit at all) - a single 5 eliminates one, "the last Parki to arrive" being the same
  // arrival-order tie-break resolveBarrierElimination already uses for two exposed opposing pawns.
  describe('two foreign Parkis (neither the shelter owner\'s own) already paired on the entry square (client\'s guide, page 7)', () => {
    function buildBoard(): BoardData {
      return {
        playerCount: 2,
        trackLength: 40,
        lanes: {
          Red: { color: 'Red', entryTrackIndex: 0, homeEntranceTrackIndex: 2, corridorLength: 2 },
          Blue: { color: 'Blue', entryTrackIndex: 20, homeEntranceTrackIndex: 19, corridorLength: 6 },
        },
        safeTrackIndices: new Set([0, 20]),
      }
    }

    it('single 5 eliminates whichever of the two arrived later', () => {
      const board = buildBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      const green = createPlayerState('Green', board)
      blue.parkiller.corridorPosition = blue.parkiller.corridorLength
      blue.parkiller.trackPosition = 0
      blue.parkiller.arrivedAt = 1
      green.parkiller.corridorPosition = green.parkiller.corridorLength
      green.parkiller.trackPosition = 0
      green.parkiller.arrivedAt = 2 // arrived later - this is the one that should go

      const dice = new ScriptedDice([5, 2, 1])
      const manager = new TurnManager(board, [red, blue, green], defaultRuleSettings(), dice)

      manager.requestRoll()
      const result = manager.submitMove(red.pieces[0])

      expect(result?.capturedParkillerColor).toBe('Green')
      expect(green.parkiller.state).toBe('Eliminated')
      expect(blue.parkiller.state).toBe('InPlay') // arrived first - protected by the tie-break
      expect(red.pieces[0].state).toBe('OnTrack')
      expect(red.pieces[0].trackPosition).toBe(0)
    })

    // The page's own first illustration is specifically a *double* 5 with only one shelter pawn
    // left, not a plain single 5 (the sibling test above) - same resolution either way (this exit
    // was never blocked to begin with, single or double), but worth locking in precisely as shown.
    it('double 5, only one shelter pawn: still eliminates whichever of the two arrived later', () => {
      const board = buildBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      const green = createPlayerState('Green', board)
      blue.parkiller.corridorPosition = blue.parkiller.corridorLength
      blue.parkiller.trackPosition = 0
      blue.parkiller.arrivedAt = 1
      green.parkiller.corridorPosition = green.parkiller.corridorLength
      green.parkiller.trackPosition = 0
      green.parkiller.arrivedAt = 2 // arrived later - this is the one that should go
      red.pieces[1].state = 'Finished'
      red.pieces[2].state = 'Finished'
      red.pieces[3].state = 'Finished'

      const dice = new ScriptedDice([5, 5, 1]) // a genuine double, unlike the sibling test above
      const manager = new TurnManager(board, [red, blue, green], defaultRuleSettings(), dice)

      manager.requestRoll()
      const result = manager.submitMove(red.pieces[0])

      expect(result?.capturedParkillerColor).toBe('Green')
      expect(green.parkiller.state).toBe('Eliminated')
      expect(blue.parkiller.state).toBe('InPlay')
      expect(red.pieces[0].state).toBe('OnTrack')
      expect(red.pieces[0].trackPosition).toBe(0)
    })

    it('double 5, two shelter pawns: the first exit eliminates the later arrival, the second eliminates the other', () => {
      const board = buildBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      const green = createPlayerState('Green', board)
      blue.parkiller.corridorPosition = blue.parkiller.corridorLength
      blue.parkiller.trackPosition = 0
      blue.parkiller.arrivedAt = 1
      green.parkiller.corridorPosition = green.parkiller.corridorLength
      green.parkiller.trackPosition = 0
      green.parkiller.arrivedAt = 2

      const dice = new ScriptedDice([5, 5, 1])
      const manager = new TurnManager(board, [red, blue, green], defaultRuleSettings(), dice)
      let latestMoves: MoveOption[] = []
      manager.moveChoicesReady.on((m) => (latestMoves = m))

      manager.requestRoll()
      const r1 = manager.submitMove(red.pieces[0])

      expect(r1?.capturedParkillerColor).toBe('Green')
      expect(green.parkiller.state).toBe('Eliminated')
      expect(blue.parkiller.state).toBe('InPlay') // not yet - only the first exit has happened

      const secondExit = latestMoves.find((m) => m.kind === 'ExitYard')
      expect(secondExit).toBeTruthy()
      const r2 = manager.submitMove(secondExit!.piece)

      expect(r2?.capturedParkillerColor).toBe('Blue')
      expect(blue.parkiller.state).toBe('Eliminated')
      expect(red.pieces[0].state).toBe('OnTrack')
      expect(secondExit!.piece.state).toBe('OnTrack')
      expect(secondExit!.piece.trackPosition).toBe(0)
    })
  })

  // Reported directly ("도착하기전에 이미 먹히울걸 타산해서 가기도전에 갑자기 먼저 사라지는" - the
  // piece vanishes before even arriving, as if pre-calculated): the scene layer only ever learns
  // about a move via moveAnimationReady, not by inspecting MoveResult directly - this is the actual
  // event BoardScene subscribes to, so the fix needs verifying at *this* level, not just on
  // applyMove's own return value (parchisRules.test.ts already covers that). Without
  // eliminatedByParkillerAt/eliminatedByParkillerColor surviving into this event, the scene layer
  // has no way to know which square to animate the walk toward - `after` alone already reads
  // InYard by the time this fires.
  it('surfaces eliminatedByParkillerAt/Color on the moveAnimationReady event the scene layer actually listens to (PK5)', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 2
    blue.parkiller.corridorPosition = blue.parkiller.corridorLength
    blue.parkiller.trackPosition = 5 // not a safe square on this test board

    const dice = new ScriptedDice([3, 4, 1]) // dieA=3 walks Red's pawn 2 -> 5, onto the Parkiller
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let animation: import('../src/core/gameFlow/turnManager').MoveAnimationInfo | null = null
    manager.moveAnimationReady.on((info) => (animation = info))

    manager.requestRoll()
    manager.submitMove(red.pieces[0], 3)

    expect(animation).not.toBeNull()
    expect(animation!.before).toEqual({ state: 'OnTrack', trackPosition: 2, corridorPosition: -1 })
    expect(animation!.after).toEqual({ state: 'InYard', trackPosition: -1, corridorPosition: -1 })
    expect(animation!.eliminatedByParkillerAt).toBe(5)
    expect(animation!.eliminatedByParkillerColor).toBe('Blue')
  })

  it('a pawn move landing on an opposing Parkiller without doubles does not eliminate it', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0
    blue.parkiller.corridorPosition = blue.parkiller.corridorLength
    blue.parkiller.trackPosition = 5

    const dice = new ScriptedDice([5, 2, 1]) // dieA=5, dieB=2 - not a double, the window never opens
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    manager.requestRoll()
    const result = manager.submitMove(red.pieces[0])

    expect(result?.capturedParkillerColor).toBeNull()
    expect(blue.parkiller.state).toBe('InPlay')
    expect(blue.parkiller.trackPosition).toBe(5)
  })

  it('skips rolling the black die on the bonus turn granted by doubles', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.parkiller.corridorPosition = red.parkiller.corridorLength

    // Roll 1: dieA=dieB=2 (double, no legal move for either -> immediate bonus turn), blackDie=3
    // moves the Parkiller 19 -> 16. Roll 2 (the bonus turn): dieA=1, dieB=1, blackDie=9 - still
    // rolled (a simple "always three dice" contract), but its effect must be skipped, so the
    // Parkiller must still be at 16, not moved again.
    const dice = new ScriptedDice([2, 2, 3, 1, 1, 9])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    const results: ParkillerMoveResult[] = []
    manager.parkillerMoved.on((r) => results.push(r))

    manager.requestRoll()
    expect(red.parkiller.trackPosition).toBe(16)
    manager.requestRoll()

    expect(results).toHaveLength(2)
    expect(results[1]).toEqual({
      color: 'Red',
      before: 16,
      after: 16,
      beforeCorridorPosition: 6,
      afterCorridorPosition: 6,
      capturedPawn: null,
      capturedParkillerColor: null,
    })
    expect(red.parkiller.trackPosition).toBe(16)
  })

  it('an eliminated Parkiller stays out of play on later rolls, and parkillerMoved never fires for it', () => {
    // parkillerMoved not firing at all (rather than firing with a same-position noop result) is
    // itself the fix for a real client-reported freeze - see this describe block's own dedicated
    // test above for the full mechanism.
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.parkiller.state = 'Eliminated'
    red.parkiller.trackPosition = 7

    const dice = new ScriptedDice([1, 1, 3])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let result: ParkillerMoveResult | null = null
    manager.parkillerMoved.on((r) => (result = r))

    manager.requestRoll()

    expect(result).toBeNull()
    expect(red.parkiller.state).toBe('Eliminated')
    expect(red.parkiller.trackPosition).toBe(7)
  })
})

// The corridor-crossing mechanic itself (see Parkiller.corridorPosition's own doc comment) - the
// client's own explicit, repeated instruction settled this: the black die is spent actually
// crossing the center-to-loop distance, one real square at a time, so the total distance shown
// always equals the die exactly, first roll included.
describe('TurnManager - Parkiller corridor crossing (PK1)', () => {
  it("a roll smaller than the remaining corridor doesn't reach the loop at all - trackPosition is untouched", () => {
    const board = buildTestBoard() // Red's corridorLength is 6
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)

    const dice = new ScriptedDice([1, 1, 4]) // dieA=1, dieB=1 (no legal move), blackDie=4 < corridorLength(6)
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let result: ParkillerMoveResult | null = null
    manager.parkillerMoved.on((r) => (result = r))

    manager.requestRoll()

    expect(result).toEqual({
      color: 'Red',
      before: 19,
      after: 19, // untouched - never reached the loop this roll
      beforeCorridorPosition: 0,
      afterCorridorPosition: 4,
      capturedPawn: null,
      capturedParkillerColor: null,
    })
    expect(red.parkiller.corridorPosition).toBe(4)
    expect(red.parkiller.trackPosition).toBe(19) // still the created default, never touched
  })

  it('crosses the remaining corridor exactly, landing precisely on the home-entrance square with nothing left over', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)

    const dice = new ScriptedDice([1, 1, 6]) // blackDie=6 === corridorLength(6) exactly
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    manager.requestRoll()

    expect(red.parkiller.corridorPosition).toBe(6)
    expect(red.parkiller.trackPosition).toBe(19) // home-entrance square itself, no leftover pips
  })

  it('crosses the corridor over two separate rolls, then spends any leftover on the loop the roll it finishes crossing', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)

    // Red roll 1: dieA=1,dieB=2 (not a double, sum=3 != exitRoll 5, no legal move -> turn passes to
    // Blue), blackDie=4 (< corridorLength 6) - only advances corridorPosition, stays off the loop.
    // Blue roll: same shape dice, just to pass its own turn cleanly back to Red.
    // Red roll 2 (its own next real turn, not a bonus turn - PK2/PK6a explicitly skips the black
    // die's effect on a bonus turn, so that couldn't demonstrate this at all): blackDie=3 - crosses
    // the remaining 2 corridor squares, with 1 pip left over to spend moving along the loop: 19 -> 18.
    const dice = new ScriptedDice([1, 2, 4, 1, 2, 1, 1, 2, 3])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    manager.requestRoll() // Red
    expect(red.parkiller.corridorPosition).toBe(4)
    expect(red.parkiller.trackPosition).toBe(19)

    manager.requestRoll() // Blue's own turn
    manager.requestRoll() // back to Red
    expect(red.parkiller.corridorPosition).toBe(6)
    expect(red.parkiller.trackPosition).toBe(18) // 2 squares crossed the remaining corridor, 1 leftover pip moved the loop
  })

  it('captures a pawn only on the roll that actually crosses onto the loop, never while still in the corridor', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 19 // sitting right on Red's own home-entrance square

    const dice = new ScriptedDice([1, 1, 6]) // blackDie=6 === corridorLength(6) - crosses exactly onto 19
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let result: ParkillerMoveResult | null = null
    manager.parkillerMoved.on((r) => (result = r))

    manager.requestRoll()

    expect(result).toEqual({
      color: 'Red',
      before: 19,
      after: 19,
      beforeCorridorPosition: 0,
      afterCorridorPosition: 6,
      capturedPawn: blue.pieces[0],
      capturedParkillerColor: null,
      secondCapturedParkillerColor: null,
    })
    expect(blue.pieces[0].state).toBe('InYard')
  })

  it("an opposing Parkiller still crossing its own corridor can't be captured - its trackPosition is stale, not a real square", () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.parkiller.corridorPosition = red.parkiller.corridorLength
    // blue.parkiller.trackPosition still defaults to Blue's own homeEntranceTrackIndex (9) - stale,
    // since blue.parkiller.corridorPosition is still 0 (fresh, hasn't crossed its own corridor yet).

    const dice = new ScriptedDice([1, 1, 10]) // Red's parkiller: 19 -> 9 (Blue's stale trackPosition)
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    manager.requestRoll()

    expect(red.parkiller.trackPosition).toBe(9)
    expect(blue.parkiller.state).toBe('InPlay') // not actually there - never captured
  })
})
