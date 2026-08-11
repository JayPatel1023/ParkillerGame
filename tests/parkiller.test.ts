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
    expect(createParkiller('Red', 19)).toEqual({ color: 'Red', state: 'InPlay', trackPosition: 19 })
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

    expect(result).toEqual({ color: 'Red', before: 19, after: 16, capturedPawn: null, capturedParkillerColor: null })
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

    expect(result).toEqual({ color: 'Red', before: 19, after: 16, capturedPawn: blue.pieces[0], capturedParkillerColor: null })
    expect(blue.pieces[0].state).toBe('InYard')
    expect(blue.pieces[0].trackPosition).toBe(-1)
    expect(rewardOffered).toBe(false)
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

  it('a pawn move landing on an opposing Parkiller eliminates it and grants a reward', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0
    blue.parkiller.trackPosition = 5

    const dice = new ScriptedDice([5, 1, 1]) // dieA=5 moves red.pieces[0] 0 -> 5, onto blue's parkiller
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    const grants: RewardGrant[] = []
    manager.rewardOffered.on((g) => grants.push(g))

    manager.requestRoll()
    const result = manager.submitMove(red.pieces[0])

    expect(result?.capturedParkillerColor).toBe('Blue')
    expect(blue.parkiller.state).toBe('Eliminated')
    expect(grants).toEqual([{ amount: 20, reason: 'capture' }])
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

    expect(result).toEqual({ color: 'Red', before: 7, after: 7, capturedPawn: null, capturedParkillerColor: null })
    expect(red.parkiller.trackPosition).toBe(7)
  })
})
