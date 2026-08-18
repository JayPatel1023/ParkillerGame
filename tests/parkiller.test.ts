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
  it('starts InPlay at the given home-entrance track index', () => {
    expect(createParkiller('Red', 19)).toEqual({ color: 'Red', state: 'InPlay', trackPosition: 19, hasMoved: false })
  })
})

describe('TurnManager - Parkiller (PK 1-8)', () => {
  it('moves backward (decreasing track index) by the black die each roll', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)

    const dice = new ScriptedDice([1, 1, 3]) // dieA=1, dieB=1 (no legal move exists), blackDie=3
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let result: ParkillerMoveResult | null = null
    manager.parkillerMoved.on((r) => (result = r))

    manager.requestRoll()

    expect(result).toEqual({ color: 'Red', before: 19, after: 16, capturedPawn: null, capturedParkillerColor: null, firstMove: true })
    expect(red.parkiller.trackPosition).toBe(16)
  })

  it('captures an opposing pawn it lands on, with no reward to the mover', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 16 // Red's parkiller (starts at 19) lands here with blackDie=3

    const dice = new ScriptedDice([1, 1, 3])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let result: ParkillerMoveResult | null = null
    manager.parkillerMoved.on((r) => (result = r))
    let rewardOffered = false
    manager.rewardOffered.on(() => (rewardOffered = true))

    manager.requestRoll()

    expect(result).toEqual({ color: 'Red', before: 19, after: 16, capturedPawn: blue.pieces[0], capturedParkillerColor: null, firstMove: true })
    expect(blue.pieces[0].state).toBe('InYard')
    expect(blue.pieces[0].trackPosition).toBe(-1)
    expect(rewardOffered).toBe(false)
  })

  it('landing on a barrier (2 pawns) eliminates only the one that does not share its own color (PK5/PK10)', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 16
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 16 // barrier: Red's own pawn + Blue's, on Red's Parkiller's path

    const dice = new ScriptedDice([1, 1, 3]) // Red's parkiller: 19 -> 16
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let result: ParkillerMoveResult | null = null
    manager.parkillerMoved.on((r) => (result = r))

    manager.requestRoll()

    expect(result).toEqual({ color: 'Red', before: 19, after: 16, capturedPawn: blue.pieces[0], capturedParkillerColor: null, firstMove: true })
    expect(blue.pieces[0].state).toBe('InYard')
    // Red's own pawn is protected by sharing the Parkiller's color - stays right where it was.
    expect(red.pieces[0].state).toBe('OnTrack')
    expect(red.pieces[0].trackPosition).toBe(16)
  })

  it('does not capture a pawn sitting on a protected square', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
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
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0 // needs a piece already in play to spend the reward on (PC 5)
    blue.parkiller.trackPosition = 15 // reachable from Red's parkiller start (19) with blackDie=4

    const dice = new ScriptedDice([1, 1, 4])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    const grants: RewardGrant[] = []
    manager.rewardOffered.on((g) => grants.push(g))
    let latestMoves: MoveOption[] = []
    manager.moveChoicesReady.on((m) => (latestMoves = m))

    manager.requestRoll()

    expect(blue.parkiller.state).toBe('Eliminated')
    expect(grants).toEqual([{ amount: 20, reason: 'capture' }])
    expect(latestMoves.length).toBeGreaterThan(0)
    expect(latestMoves.every((m) => m.diceSource === 'reward' && m.amount === 20)).toBe(true)
  })

  it('a pawn move landing on an opposing Parkiller during a doubles roll eliminates it and grants a reward', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0
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
    blue.parkiller.trackPosition = 0 // sitting right on Red's own exit

    const dice = new ScriptedDice([5, 2, 1]) // dieA=5 exits a yard piece onto position 0
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    manager.requestRoll()
    const result = manager.submitMove(red.pieces[0])

    expect(result?.eliminatedByParkiller).toBe(true)
    expect(red.pieces[0].state).toBe('InYard')
    expect(blue.parkiller.state).toBe('InPlay') // the Parkiller itself is unharmed
  })

  it('a pawn move landing on an opposing Parkiller without doubles does not eliminate it', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0
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
    expect(results[1]).toEqual({ color: 'Red', before: 16, after: 16, capturedPawn: null, capturedParkillerColor: null, firstMove: false })
    expect(red.parkiller.trackPosition).toBe(16)
  })

  it('an eliminated Parkiller stays out of play on later rolls', () => {
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

    expect(result).toEqual({ color: 'Red', before: 7, after: 7, capturedPawn: null, capturedParkillerColor: null, firstMove: false })
    expect(red.parkiller.trackPosition).toBe(7)
  })
})
