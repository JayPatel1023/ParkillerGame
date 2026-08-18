import { describe, expect, it } from 'vitest'
import type { BoardData } from '../src/core/board/boardData'
import { createPlayerState, hasWon } from '../src/core/gameFlow/playerState'
import { createPiece } from '../src/core/pieces/piece'
import { applyMove, getValidMoves, resolveBarrierElimination, wouldCapture } from '../src/core/rules/parchisRules'
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

  describe('departure / entry square (PC2.1)', () => {
    it('exiting the yard onto a lone opponent pawn does not capture it - they simply coexist', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      blue.pieces[0].state = 'OnTrack'
      blue.pieces[0].trackPosition = 0 // Red's own entry square, which is also a safe square

      const settings = defaultRuleSettings()
      const move = getValidMoves(board, red, [red, blue], 5, settings).find((m) => m.kind === 'ExitYard')!
      const result = applyMove(board, move, [red, blue], settings, true)

      expect(result.capturedPiece).toBeNull()
      expect(blue.pieces[0].state).toBe('OnTrack')
      expect(red.pieces[0].state).toBe('OnTrack')
    })

    it('two of the player\'s own pawns already on the entry square block a third pawn from exiting', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      red.pieces[0].state = 'OnTrack'
      red.pieces[0].trackPosition = 0
      red.pieces[1].state = 'OnTrack'
      red.pieces[1].trackPosition = 0

      const settings = defaultRuleSettings()
      const moves = getValidMoves(board, red, [red], 5, settings)
      expect(moves.find((m) => m.kind === 'ExitYard')).toBeUndefined()
    })

    it('one own pawn plus one opponent pawn on the entry square still allows exit, capturing the opponent', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      red.pieces[0].state = 'OnTrack'
      red.pieces[0].trackPosition = 0
      blue.pieces[0].state = 'OnTrack'
      blue.pieces[0].trackPosition = 0

      const settings = defaultRuleSettings()
      const exitMove = getValidMoves(board, red, [red, blue], 5, settings).find((m) => m.kind === 'ExitYard')
      expect(exitMove).toBeTruthy()

      const result = applyMove(board, exitMove!, [red, blue], settings, true)
      expect(result.capturedPiece).toBe(blue.pieces[0])
    })

    it('two opposing pawns already on the entry square block exit as a foreign barrier', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      blue.pieces[0].state = 'OnTrack'
      blue.pieces[0].trackPosition = 0
      blue.pieces[1].state = 'OnTrack'
      blue.pieces[1].trackPosition = 0

      const settings = defaultRuleSettings()
      const moves = getValidMoves(board, red, [red, blue], 5, settings)
      expect(moves.find((m) => m.kind === 'ExitYard')).toBeUndefined()
    })

    it('two *different-colored* opponents on the entry square are not a barrier - exit is allowed, eliminating whichever arrived later', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      const gold = createPlayerState('Gold', board)
      blue.pieces[0].state = 'OnTrack'
      blue.pieces[0].trackPosition = 0
      blue.pieces[0].arrivedAt = 3 // arrived first
      gold.pieces[0].state = 'OnTrack'
      gold.pieces[0].trackPosition = 0
      gold.pieces[0].arrivedAt = 7 // arrived later - this one goes

      const settings = defaultRuleSettings()
      const exitMove = getValidMoves(board, red, [red, blue, gold], 5, settings).find((m) => m.kind === 'ExitYard')
      expect(exitMove).toBeTruthy()

      const result = applyMove(board, exitMove!, [red, blue, gold], settings, true)
      expect(result.capturedPiece).toBe(gold.pieces[0])
      expect(gold.pieces[0].state).toBe('InYard')
      expect(blue.pieces[0].state).toBe('OnTrack') // the earlier arrival is untouched
      expect(blue.pieces[0].trackPosition).toBe(0)
    })
  })

  describe('landing on an opposing Parkiller (PK5)', () => {
    it('sends the mover back to the yard when it lands on an unprotected opposing Parkiller without eliminating it', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      red.pieces[0].state = 'OnTrack'
      red.pieces[0].trackPosition = 2
      blue.parkiller.trackPosition = 5 // not a safe square on this test board

      const settings = defaultRuleSettings()
      const move = getValidMoves(board, red, [red, blue], 3, settings)[0] // 2 -> 5
      const result = applyMove(board, move, [red, blue], settings, false) // no doubles window open

      expect(result.eliminatedByParkiller).toBe(true)
      expect(result.capturedParkillerColor).toBeNull()
      expect(red.pieces[0].state).toBe('InYard')
      expect(red.pieces[0].trackPosition).toBe(-1)
      expect(blue.parkiller.state).toBe('InPlay') // the Parkiller itself is untouched
    })

    it('does not send the mover home when it lands on an opposing Parkiller sitting on a safe square', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      red.pieces[0].state = 'OnTrack'
      red.pieces[0].trackPosition = 7
      blue.parkiller.trackPosition = 10 // a safe square on this test board

      const settings = defaultRuleSettings()
      const move = getValidMoves(board, red, [red, blue], 3, settings)[0] // 7 -> 10
      const result = applyMove(board, move, [red, blue], settings, false)

      expect(result.eliminatedByParkiller).toBeFalsy()
      expect(red.pieces[0].state).toBe('OnTrack')
      expect(red.pieces[0].trackPosition).toBe(10)
    })

    it('does not send the mover home when the same move instead eliminates the Parkiller (PK6 takes priority)', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      red.pieces[0].state = 'OnTrack'
      red.pieces[0].trackPosition = 2
      blue.parkiller.trackPosition = 5

      const settings = defaultRuleSettings()
      const move = getValidMoves(board, red, [red, blue], 3, settings, 'dieA')[0] // 2 -> 5, single die
      const result = applyMove(board, move, [red, blue], settings, true) // doubles window open

      expect(result.capturedParkillerColor).toBe('Blue')
      expect(result.eliminatedByParkiller).toBeFalsy()
      expect(red.pieces[0].state).toBe('OnTrack')
      expect(red.pieces[0].trackPosition).toBe(5)
    })
  })

  describe('resolveBarrierElimination (PK5/PK10 - a Parkiller landing on a barrier)', () => {
    it('when one pawn shares the Parkiller\'s own color, eliminates the other pawn instead (protection)', () => {
      const own = { ...createPiece('Red', 0), arrivedAt: 5 }
      const other = { ...createPiece('Blue', 0), arrivedAt: 9 } // arrived later, but color still decides it
      expect(resolveBarrierElimination('Red', [own, other])).toBe(other)
      expect(resolveBarrierElimination('Red', [other, own])).toBe(other) // order-independent
    })

    it('when both pawns share the Parkiller\'s own color, eliminates whichever arrived last', () => {
      const earlier = { ...createPiece('Red', 0), arrivedAt: 3 }
      const later = { ...createPiece('Red', 1), arrivedAt: 7 }
      expect(resolveBarrierElimination('Red', [earlier, later])).toBe(later)
      expect(resolveBarrierElimination('Red', [later, earlier])).toBe(later)
    })

    it('when neither pawn shares the Parkiller\'s own color, eliminates whichever arrived last', () => {
      const earlier = { ...createPiece('Blue', 0), arrivedAt: 2 }
      const later = { ...createPiece('Gold', 0), arrivedAt: 6 }
      expect(resolveBarrierElimination('Red', [earlier, later])).toBe(later)
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
      // A single die's own value, not the sum - PK6 only allows a single-die move to kill the
      // Parkiller ("se mueve con la cifra de un dado"), even during the doubles window.
      const parkillerMove = getValidMoves(board, attacker, [attacker, defender], 3, settings, 'dieA').find(
        (m) => m.piece === attacker.pieces[1],
      )!

      expect(wouldCapture(board, safeMove, [attacker, defender], true)).toBe(false)
      expect(wouldCapture(board, parkillerMove, [attacker, defender], false)).toBe(false)
      expect(wouldCapture(board, parkillerMove, [attacker, defender], true)).toBe(true)
    })

    it('does not flag a Parkiller capture when the move spends the sum of both dice, even during the doubles window', () => {
      // PK6: "Se mueve con la cifra de un dado el peón que elimina al Parkiller" - only a single
      // die's own face value counts, never the combined sum, even on the double that opens the window.
      const board = buildTestBoard()
      const attacker = createPlayerState('Red', board)
      const defender = createPlayerState('Blue', board)
      attacker.pieces[0].state = 'OnTrack'
      attacker.pieces[0].trackPosition = 7
      defender.parkiller.trackPosition = 10

      const settings = defaultRuleSettings()
      const sumMove = getValidMoves(board, attacker, [attacker, defender], 3, settings, 'sum').find((m) => m.piece === attacker.pieces[0])!

      expect(wouldCapture(board, sumMove, [attacker, defender], true)).toBe(false)
    })
  })
})
