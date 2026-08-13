import { describe, expect, it } from 'vitest'
import type { BoardData } from '../src/core/board/boardData'
import { createPlayerState, hasWon } from '../src/core/gameFlow/playerState'
import { applyMove, getValidMoves, wouldCapture } from '../src/core/rules/parchisRules'
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
  it('a piece in the yard cannot move without the exit roll', () => {
    const board = buildTestBoard()
    const player = createPlayerState('Red', board)
    const settings = defaultRuleSettings()

    expect(getValidMoves(board, player, [player], 4, settings)).toHaveLength(0)
  })

  it('a piece in the yard can exit with a five (rulebook: 2 white dice, not the classic six)', () => {
    const board = buildTestBoard()
    const player = createPlayerState('Red', board)
    const settings = defaultRuleSettings()

    const moves = getValidMoves(board, player, [player], 5, settings)

    expect(moves).toHaveLength(4)
    expect(moves[0].kind).toBe('ExitYard')
    expect(moves[0].resultingTrackPosition).toBe(0)
  })

  it('landing on an opponent on an unsafe square captures it', () => {
    const board = buildTestBoard()
    const attacker = createPlayerState('Red', board)
    const defender = createPlayerState('Blue', board)

    defender.pieces[0].state = 'OnTrack'
    defender.pieces[0].trackPosition = 3

    attacker.pieces[0].state = 'OnTrack'
    attacker.pieces[0].trackPosition = 0

    const settings = defaultRuleSettings()
    const move = getValidMoves(board, attacker, [attacker, defender], 3, settings)[0]
    const result = applyMove(board, move, [attacker, defender], settings, true)

    expect(result.capturedPiece).toBe(defender.pieces[0])
    expect(defender.pieces[0].state).toBe('InYard')
  })

  it('landing on an opponent on a safe square does not capture', () => {
    const board = buildTestBoard()
    const attacker = createPlayerState('Red', board)
    const defender = createPlayerState('Blue', board)

    defender.pieces[0].state = 'OnTrack'
    defender.pieces[0].trackPosition = 10 // a safe square

    attacker.pieces[0].state = 'OnTrack'
    attacker.pieces[0].trackPosition = 7

    const settings = defaultRuleSettings()
    const move = getValidMoves(board, attacker, [attacker, defender], 3, settings)[0]
    const result = applyMove(board, move, [attacker, defender], settings, true)

    expect(result.capturedPiece).toBeNull()
    expect(defender.pieces[0].state).toBe('OnTrack')
  })

  it('an exact roll to finish finishes the piece', () => {
    const board = buildTestBoard()
    const player = createPlayerState('Red', board)
    player.pieces[0].state = 'InHomeCorridor'
    player.pieces[0].corridorPosition = 1 // 2 steps from the last corridor square (index 3)

    const settings = defaultRuleSettings()
    const moves = getValidMoves(board, player, [player], 2, settings)

    expect(moves).toHaveLength(1)
    expect(moves[0].kind).toBe('FinishMove')

    const result = applyMove(board, moves[0], [player], settings, true)
    expect(result.pieceFinished).toBe(true)
    expect(player.pieces[0].state).toBe('Finished')
  })

  it('overshooting past the finish is not a valid move', () => {
    const board = buildTestBoard()
    const player = createPlayerState('Red', board)
    player.pieces[0].state = 'InHomeCorridor'
    player.pieces[0].corridorPosition = 2 // 1 step from finish

    // amount=2 both overshoots this piece and (unlike 5) doesn't coincide with the yard exit roll,
    // which would otherwise let the player's other, still-InYard pieces "move" too.
    const settings = defaultRuleSettings()
    expect(getValidMoves(board, player, [player], 2, settings)).toHaveLength(0)
  })

  it('a player with all pieces finished has won', () => {
    const board = buildTestBoard()
    const player = createPlayerState('Red', board)
    for (const piece of player.pieces) piece.state = 'Finished'

    expect(hasWon(player)).toBe(true)
  })

  describe('barriers (PC2.4)', () => {
    it('two pieces already sharing a square block a third piece from landing there', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)

      red.pieces[0].state = 'OnTrack'
      red.pieces[0].trackPosition = 5
      red.pieces[1].state = 'OnTrack'
      red.pieces[1].trackPosition = 5 // Red barrier at 5

      blue.pieces[0].state = 'OnTrack'
      blue.pieces[0].trackPosition = 2

      const settings = defaultRuleSettings()
      const moves = getValidMoves(board, blue, [red, blue], 3, settings) // 2 -> 5
      expect(moves.find((m) => m.piece === blue.pieces[0])).toBeUndefined()
    })

    it('a barrier blocks passage through it, not just landing on it', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)

      red.pieces[0].state = 'OnTrack'
      red.pieces[0].trackPosition = 5
      red.pieces[1].state = 'OnTrack'
      red.pieces[1].trackPosition = 5 // Red barrier at 5

      blue.pieces[0].state = 'OnTrack'
      blue.pieces[0].trackPosition = 2

      const settings = defaultRuleSettings()
      const moves = getValidMoves(board, blue, [red, blue], 5, settings) // 2 -> 7, crossing 5
      expect(moves.find((m) => m.piece === blue.pieces[0])).toBeUndefined()
    })

    it('a second own piece can join a square with one own piece already there, forming a barrier', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)

      red.pieces[0].state = 'OnTrack'
      red.pieces[0].trackPosition = 3
      red.pieces[1].state = 'OnTrack'
      red.pieces[1].trackPosition = 1

      const settings = defaultRuleSettings()
      const moves = getValidMoves(board, red, [red], 2, settings) // piece1: 1 -> 3
      const move = moves.find((m) => m.piece === red.pieces[1])
      expect(move?.resultingTrackPosition).toBe(3)
    })

    it('a home-corridor square already holding one piece blocks another from landing there', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)

      red.pieces[0].state = 'InHomeCorridor'
      red.pieces[0].corridorPosition = 2
      red.pieces[1].state = 'InHomeCorridor'
      red.pieces[1].corridorPosition = 1

      const settings = defaultRuleSettings()
      const moves = getValidMoves(board, red, [red], 1, settings) // piece1 would land on piece0's square (2), not the final (3)
      expect(moves.find((m) => m.piece === red.pieces[1])).toBeUndefined()
    })

    it('the final home-corridor square allows multiple pieces to stack', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)

      red.pieces[0].state = 'Finished'
      red.pieces[0].corridorPosition = 3
      red.pieces[1].state = 'InHomeCorridor'
      red.pieces[1].corridorPosition = 2

      const settings = defaultRuleSettings()
      const moves = getValidMoves(board, red, [red], 1, settings) // piece1: 2 -> 3 (the final square)
      const move = moves.find((m) => m.piece === red.pieces[1])
      expect(move?.kind).toBe('FinishMove')
    })
  })

  describe('mandatory capture (PC3/PK8)', () => {
    it('flags a move landing on an opposing piece as a capture', () => {
      const board = buildTestBoard()
      const attacker = createPlayerState('Red', board)
      const defender = createPlayerState('Blue', board)
      defender.pieces[0].state = 'OnTrack'
      defender.pieces[0].trackPosition = 3
      attacker.pieces[0].state = 'OnTrack'
      attacker.pieces[0].trackPosition = 0

      const move = getValidMoves(board, attacker, [attacker, defender], 3, defaultRuleSettings())[0]
      expect(wouldCapture(board, move, [attacker, defender], false)).toBe(true)
    })

    it('does not flag a capture on a safe square, or of the Parkiller without the doubles window', () => {
      const board = buildTestBoard()
      const attacker = createPlayerState('Red', board)
      const defender = createPlayerState('Blue', board)
      defender.pieces[0].state = 'OnTrack'
      defender.pieces[0].trackPosition = 10 // safe square
      attacker.pieces[0].state = 'OnTrack'
      attacker.pieces[0].trackPosition = 7
      defender.parkiller.trackPosition = 12
      attacker.pieces[1].state = 'OnTrack'
      attacker.pieces[1].trackPosition = 9

      const settings = defaultRuleSettings()
      const safeMove = getValidMoves(board, attacker, [attacker, defender], 3, settings).find((m) => m.piece === attacker.pieces[0])!
      const parkillerMove = getValidMoves(board, attacker, [attacker, defender], 3, settings).find((m) => m.piece === attacker.pieces[1])!

      expect(wouldCapture(board, safeMove, [attacker, defender], true)).toBe(false)
      expect(wouldCapture(board, parkillerMove, [attacker, defender], false)).toBe(false)
      expect(wouldCapture(board, parkillerMove, [attacker, defender], true)).toBe(true)
    })
  })
})
