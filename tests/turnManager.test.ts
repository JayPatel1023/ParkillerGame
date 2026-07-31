import { describe, expect, it } from 'vitest'
import type { BoardData } from '../src/core/board/boardData'
import type { DiceLike } from '../src/core/dice'
import { createPlayerState } from '../src/core/gameFlow/playerState'
import { TurnManager, type DiceRoll } from '../src/core/gameFlow/turnManager'
import { defaultRuleSettings } from '../src/core/rules/ruleSettings'

// Rolls a fixed, hand-picked sequence instead of a seed - a seed is deterministic but its face
// values aren't hand-pickable, and these tests need exact pairs (doubles, a specific sum, etc).
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
    safeTrackIndices: new Set([0, 10]),
  }
}

describe('TurnManager - two-dice rulebook flow', () => {
  it('offers a die-A move and a die-B move for two different pieces on the same roll', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red')
    const blue = createPlayerState('Blue')
    red.pieces[0].state = 'InHomeCorridor'
    red.pieces[0].corridorPosition = 1 // +4 (die A) lands exactly on the finish square (index 5)
    red.pieces[1].state = 'InHomeCorridor'
    red.pieces[1].corridorPosition = 3 // +2 (die B) lands exactly on the finish square; +4 overshoots

    const dice = new ScriptedDice([4, 2])
    const settings = defaultRuleSettings()
    const manager = new TurnManager(board, [red, blue], settings, dice)

    let offered: DiceRoll | null = null
    manager.diceRolled.on((roll) => (offered = roll))
    let latestMoves: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((m) => (latestMoves = m))

    manager.requestRoll()

    expect(offered).toEqual({ dieA: 4, dieB: 2 })
    expect(latestMoves).toHaveLength(2)
    const forPiece0 = latestMoves.find((m) => m.piece === red.pieces[0])
    const forPiece1 = latestMoves.find((m) => m.piece === red.pieces[1])
    expect(forPiece0?.diceSource).toBe('dieA')
    expect(forPiece0?.amount).toBe(4)
    expect(forPiece1?.diceSource).toBe('dieB')
    expect(forPiece1?.amount).toBe(2)

    // spend die A on piece 0 - die B should still be offered afterward for piece 1
    manager.submitMove(red.pieces[0])
    expect(red.pieces[0].state).toBe('Finished')
    expect(latestMoves).toHaveLength(1)
    expect(latestMoves[0].piece).toBe(red.pieces[1])
    expect(latestMoves[0].diceSource).toBe('dieB')

    manager.submitMove(red.pieces[1])
    expect(red.pieces[1].state).toBe('Finished')
  })

  it('exits the yard on a single die showing the exit roll', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red')
    const blue = createPlayerState('Blue')
    const dice = new ScriptedDice([5, 1])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let latestMoves: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((m) => (latestMoves = m))
    manager.requestRoll()

    const exitOption = latestMoves.find((m) => m.kind === 'ExitYard')
    expect(exitOption).toBeTruthy()
    expect(exitOption?.diceSource).toBe('dieA')
    expect(exitOption?.amount).toBe(5)
  })

  it('exits the yard on the sum of both dice when neither die alone shows the exit roll', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red')
    const blue = createPlayerState('Blue')
    const dice = new ScriptedDice([2, 3]) // neither die is 5, but 2+3=5
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let latestMoves: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((m) => (latestMoves = m))
    manager.requestRoll()

    const exitOption = latestMoves.find((m) => m.kind === 'ExitYard')
    expect(exitOption).toBeTruthy()
    expect(exitOption?.diceSource).toBe('sum')
    expect(exitOption?.amount).toBe(5)
  })

  it('grants an extra turn on doubles without advancing to the next player', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red')
    const blue = createPlayerState('Blue')
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0

    const dice = new ScriptedDice([2, 2])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let currentPlayerColor: string | null = null
    manager.turnStarted.on((p) => (currentPlayerColor = p.color))
    manager.moveChoicesReady.on(() => manager.submitMove(red.pieces[0]))

    manager.requestRoll() // moves piece0 by die A (2), then by die B (2) via the auto-submit above
    expect(red.pieces[0].trackPosition).toBe(4)
    // still Red's turn - doubles grant a reroll instead of passing to Blue
    expect(currentPlayerColor).toBe('Red')
  })

  it('a third consecutive double eliminates the last piece moved and ends the turn', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red')
    const blue = createPlayerState('Blue')
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0

    const dice = new ScriptedDice([2, 2, 3, 3, 4, 4])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let eliminated: import('../src/core/pieces/piece').Piece | null = null
    manager.pieceEliminatedByDoubles.on((piece) => (eliminated = piece))
    manager.moveChoicesReady.on(() => manager.submitMove(red.pieces[0]))

    manager.requestRoll() // double 2,2 -> moves piece0 twice, reroll granted
    manager.requestRoll() // double 3,3 -> moves piece0 twice again, reroll granted
    manager.requestRoll() // double 4,4 -> third double: no move offered, piece0 eliminated

    expect(eliminated).toBe(red.pieces[0])
    expect(red.pieces[0].state).toBe('InYard')
    expect(red.pieces[0].trackPosition).toBe(-1)
    expect(manager.currentPlayer.color).toBe('Blue') // turn passed on after the elimination
  })

  it('a piece in the home corridor is exempt from third-double elimination', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red')
    const blue = createPlayerState('Blue')
    red.pieces[0].state = 'InHomeCorridor'
    red.pieces[0].corridorPosition = 0

    // Two doubles of 1,1 move the piece from corridor position 0 to 4 (one square short of the
    // finish at index 5), so it's still InHomeCorridor - not Finished - when the third double
    // (1,1 again) hits the elimination check. What that third roll's dice do afterward isn't the
    // point of this test, only that the exemption fires instead of sending the piece to the yard.
    const dice = new ScriptedDice([1, 1, 1, 1, 1, 1])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let eliminated = false
    manager.pieceEliminatedByDoubles.on(() => (eliminated = true))
    manager.moveChoicesReady.on((moves) => {
      if (moves.length > 0) manager.submitMove(moves[0].piece)
    })

    manager.requestRoll()
    manager.requestRoll()
    manager.requestRoll()

    expect(eliminated).toBe(false)
    expect(red.pieces[0].state).not.toBe('InYard')
  })
})
