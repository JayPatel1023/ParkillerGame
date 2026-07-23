import { describe, expect, it } from 'vitest'
import type { BoardData } from '../src/core/board/boardData'
import { createPlayerState, hasWon } from '../src/core/gameFlow/playerState'
import { applyMove, getValidMoves } from '../src/core/rules/parchisRules'
import { defaultRuleSettings } from '../src/core/rules/ruleSettings'

function buildTestBoard(): BoardData {
  return {
    playerCount: 2,
    trackLength: 20,
    lanes: {
      Red: { color: 'Red', entryTrackIndex: 0, homeEntranceTrackIndex: 19, corridorLength: 4 },
      Blue: { color: 'Blue', entryTrackIndex: 10, homeEntranceTrackIndex: 9, corridorLength: 4 },
    },
    safeTrackIndices: new Set([0, 10]),
  }
}

describe('parchisRules', () => {
  it('a piece in the yard cannot move without the entry roll', () => {
    const board = buildTestBoard()
    const player = createPlayerState('Red')
    const settings = defaultRuleSettings()

    expect(getValidMoves(board, player, 4, settings)).toHaveLength(0)
  })

  it('a piece in the yard can exit with a six', () => {
    const board = buildTestBoard()
    const player = createPlayerState('Red')
    const settings = defaultRuleSettings()

    const moves = getValidMoves(board, player, 6, settings)

    expect(moves).toHaveLength(4)
    expect(moves[0].kind).toBe('ExitYard')
    expect(moves[0].resultingTrackPosition).toBe(0)
  })

  it('landing on an opponent on an unsafe square captures it', () => {
    const board = buildTestBoard()
    const attacker = createPlayerState('Red')
    const defender = createPlayerState('Blue')

    defender.pieces[0].state = 'OnTrack'
    defender.pieces[0].trackPosition = 3

    attacker.pieces[0].state = 'OnTrack'
    attacker.pieces[0].trackPosition = 0

    const settings = defaultRuleSettings()
    const move = getValidMoves(board, attacker, 3, settings)[0]
    const result = applyMove(board, move, [attacker, defender], settings)

    expect(result.capturedPiece).toBe(defender.pieces[0])
    expect(defender.pieces[0].state).toBe('InYard')
  })

  it('landing on an opponent on a safe square does not capture', () => {
    const board = buildTestBoard()
    const attacker = createPlayerState('Red')
    const defender = createPlayerState('Blue')

    defender.pieces[0].state = 'OnTrack'
    defender.pieces[0].trackPosition = 10 // a safe square

    attacker.pieces[0].state = 'OnTrack'
    attacker.pieces[0].trackPosition = 7

    const settings = defaultRuleSettings()
    const move = getValidMoves(board, attacker, 3, settings)[0]
    const result = applyMove(board, move, [attacker, defender], settings)

    expect(result.capturedPiece).toBeNull()
    expect(defender.pieces[0].state).toBe('OnTrack')
  })

  it('an exact roll to finish finishes the piece', () => {
    const board = buildTestBoard()
    const player = createPlayerState('Red')
    player.pieces[0].state = 'InHomeCorridor'
    player.pieces[0].corridorPosition = 1 // 2 steps from the last corridor square (index 3)

    const settings = defaultRuleSettings()
    const moves = getValidMoves(board, player, 2, settings)

    expect(moves).toHaveLength(1)
    expect(moves[0].kind).toBe('FinishMove')

    const result = applyMove(board, moves[0], [player], settings)
    expect(result.pieceFinished).toBe(true)
    expect(player.pieces[0].state).toBe('Finished')
  })

  it('overshooting past the finish is not a valid move', () => {
    const board = buildTestBoard()
    const player = createPlayerState('Red')
    player.pieces[0].state = 'InHomeCorridor'
    player.pieces[0].corridorPosition = 2 // 1 step from finish

    const settings = defaultRuleSettings()
    expect(getValidMoves(board, player, 5, settings)).toHaveLength(0)
  })

  it('a player with all pieces finished has won', () => {
    const player = createPlayerState('Red')
    for (const piece of player.pieces) piece.state = 'Finished'

    expect(hasWon(player)).toBe(true)
  })
})
