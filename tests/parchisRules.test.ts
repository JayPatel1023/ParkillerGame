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

    it('a home-corridor square already holding one own piece allows a second to join it (a real corridor barrier)', () => {
      // PC2.4's own rulebook text calls this out directly - a double forces the player to open a
      // barrier "including those in the finish zone" - meaning a corridor barrier is a real, legal
      // thing to form, not something the general "never more than two pawns per square" cap should
      // block below 2. Verified directly against the reference implementation's own
      // puedeApilarEnFinales(), which caps every non-final corridor square at 2, exactly like the
      // shared track - not 1, as an earlier version of this test (and the code it was checking)
      // wrongly assumed.
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)

      red.pieces[0].state = 'InHomeCorridor'
      red.pieces[0].corridorPosition = 2
      red.pieces[1].state = 'InHomeCorridor'
      red.pieces[1].corridorPosition = 1

      const settings = defaultRuleSettings()
      const moves = getValidMoves(board, red, [red], 1, settings) // piece1 joins piece0's square (2), not the final (3)
      const move = moves.find((m) => m.piece === red.pieces[1])
      expect(move).toEqual({
        piece: red.pieces[1],
        kind: 'CorridorMove',
        resultingTrackPosition: -1,
        resultingCorridorPosition: 2,
        amount: 1,
        diceSource: 'sum',
      })
    })

    it('a home-corridor square already holding two own pieces blocks a third from landing there', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)

      red.pieces[0].state = 'InHomeCorridor'
      red.pieces[0].corridorPosition = 2
      red.pieces[1].state = 'InHomeCorridor'
      red.pieces[1].corridorPosition = 2
      red.pieces[2].state = 'InHomeCorridor'
      red.pieces[2].corridorPosition = 1

      const settings = defaultRuleSettings()
      const moves = getValidMoves(board, red, [red], 1, settings) // piece2 would land on the already-full square (2), not the final (3)
      expect(moves.find((m) => m.piece === red.pieces[2])).toBeUndefined()
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

    // Reported directly, via a systematic rules audit Carlos himself requested: a move that starts
    // on the shared track and finishes inside the home corridor used to only ever check *shared
    // track* squares for a blocking barrier along the way ((trackPosition + step) % trackLength),
    // even for steps that had already actually carried the piece past the home entrance into its
    // own private corridor coordinate space. A real corridor barrier sitting in the path could be
    // silently walked straight through - this is the pass-through half of that bug.
    it('a barrier inside the home corridor blocks a track-to-corridor move that would cross it', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)

      red.pieces[0].state = 'OnTrack'
      red.pieces[0].trackPosition = 17 // distanceToHomeEntrance = 2
      red.pieces[1].state = 'InHomeCorridor'
      red.pieces[1].corridorPosition = 0
      red.pieces[2].state = 'InHomeCorridor'
      red.pieces[2].corridorPosition = 0 // own corridor barrier at index 0

      const settings = defaultRuleSettings()
      // 17 -> track 18 -> track 19 (entrance) -> corridor 0 (the barrier) -> corridor 1 (destination).
      const moves = getValidMoves(board, red, [red], 4, settings)
      expect(moves.find((m) => m.piece === red.pieces[0])).toBeUndefined()
    })

    // The other half of the same bug: the wrapped-around shared-track index a corridor-crossing
    // step used to compute could accidentally *alias* a real but entirely unrelated barrier
    // elsewhere on the shared track (a different player's own barrier this piece's real path never
    // touches at all), falsely blocking an otherwise-legal move.
    it('an unrelated barrier elsewhere on the shared track does not falsely block a track-to-corridor move', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)

      red.pieces[0].state = 'OnTrack'
      red.pieces[0].trackPosition = 18 // distanceToHomeEntrance = 1

      blue.pieces[0].state = 'OnTrack'
      blue.pieces[0].trackPosition = 0
      blue.pieces[1].state = 'OnTrack'
      blue.pieces[1].trackPosition = 0 // Blue's own barrier at track 0 - nowhere on Red's real path

      const settings = defaultRuleSettings()
      // 18 -> track 19 (entrance) -> corridor 0 -> corridor 1 (destination). Never touches track 0 -
      // the old code's own (18+2)%20=0 aliasing would have wrongly blocked this.
      const moves = getValidMoves(board, red, [red, blue], 3, settings)
      const move = moves.find((m) => m.piece === red.pieces[0])
      expect(move).toEqual({
        piece: red.pieces[0],
        kind: 'CorridorMove',
        resultingTrackPosition: -1,
        resultingCorridorPosition: 1,
        amount: 3,
        diceSource: 'sum',
      })
    })

    // Same transit gap, purely within the corridor - a move that starts already InHomeCorridor had
    // no transit check at all before, only ever checking the final landing square.
    it('a barrier inside the home corridor blocks a corridor-to-corridor move that would cross it', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)

      red.pieces[0].state = 'InHomeCorridor'
      red.pieces[0].corridorPosition = 0
      red.pieces[1].state = 'InHomeCorridor'
      red.pieces[1].corridorPosition = 1
      red.pieces[2].state = 'InHomeCorridor'
      red.pieces[2].corridorPosition = 1 // own corridor barrier at index 1

      const settings = defaultRuleSettings()
      // 0 -> 1 (the barrier) -> 2 (destination, not the final square at 3).
      const moves = getValidMoves(board, red, [red], 2, settings)
      expect(moves.find((m) => m.piece === red.pieces[0])).toBeUndefined()
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
      blue.parkiller.corridorPosition = blue.parkiller.corridorLength
      blue.parkiller.trackPosition = 5 // not a safe square on this test board

      const settings = defaultRuleSettings()
      const move = getValidMoves(board, red, [red, blue], 3, settings)[0] // 2 -> 5
      const result = applyMove(board, move, [red, blue], settings, false) // no doubles window open

      expect(result.eliminatedByParkiller).toBe(true)
      // Reported directly ("도착하기전에 이미 먹히울걸 타산해서... 사라지는" - it vanishes before
      // even arriving): the scene layer needs both of these to animate the pawn actually walking
      // to square 5 before being sent home, since `movedPiece`'s own trackPosition is already -1
      // by this point (see MoveResult's own doc comment).
      expect(result.eliminatedByParkillerAt).toBe(5)
      expect(result.eliminatedByParkillerColor).toBe('Blue')
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
      blue.parkiller.corridorPosition = blue.parkiller.corridorLength
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
      blue.parkiller.corridorPosition = blue.parkiller.corridorLength
      blue.parkiller.trackPosition = 5

      const settings = defaultRuleSettings()
      const move = getValidMoves(board, red, [red, blue], 3, settings, 'dieA')[0] // 2 -> 5, single die
      const result = applyMove(board, move, [red, blue], settings, true) // doubles window open

      expect(result.capturedParkillerColor).toBe('Blue')
      expect(result.eliminatedByParkiller).toBeFalsy()
      expect(red.pieces[0].state).toBe('OnTrack')
      expect(red.pieces[0].trackPosition).toBe(5)
    })

    // Client's own "Special Situations" guide: a lone opposing Parkiller with no pawn paired with
    // it (unlike the sibling tests above, which all start from an already-*full* entry square) is
    // exactly PK6's own ordinary "single die during a double" elimination window - already
    // verified working through the exact same applyMove machinery elsewhere in this file, this
    // test locks in that the *exit* path specifically reaches it too, since PC2.1's own exit
    // obligation is a distinct code path from a plain TrackMove.
    it('exiting via a single die of a double onto a lone foreign Parkiller eliminates it (PK6), same as any other single-die move', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      blue.parkiller.corridorPosition = blue.parkiller.corridorLength
      blue.parkiller.trackPosition = 0 // Red's own entry square, lone foreign Parkiller

      const settings = defaultRuleSettings()
      const exitMove = getValidMoves(board, red, [red, blue], 5, settings, 'dieA').find((m) => m.kind === 'ExitYard')
      expect(exitMove).toBeTruthy()

      const result = applyMove(board, exitMove!, [red, blue], settings, true) // doubles window open

      expect(result.capturedParkillerColor).toBe('Blue')
      expect(result.eliminatedByParkiller).toBeFalsy()
      expect(blue.parkiller.state).toBe('Eliminated')
      expect(red.pieces[0].state).toBe('OnTrack')
      expect(red.pieces[0].trackPosition).toBe(0)
    })
  })

  // Reported directly, with a screenshot: an opposing Parkiller and a Red pawn were already
  // coexisting on Red's own (protected) entry square (correct - PK4) when a second Red pawn exited
  // onto that same square, leaving three pieces stacked on one square - "ES IMPOSIBLE TRES FICHAS
  // EN UNA MISMA CASILLA". Root cause: every occupancy check in parchisRules.ts only ever counted
  // pawns - a Parkiller lives in PlayerState.parkiller, not the pieces array, so it was invisible
  // to every "is this square already full" question. See occupantsOnTrackSquare's own comment.
  describe('a Parkiller occupying a square counts toward the 2-piece cap (PC2/PC2.4)', () => {
    it('the exact reported scenario: exiting onto an entry square already holding an own pawn and an opposing Parkiller sends the exiting pawn straight back, never a 3-stack', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      red.pieces[0].state = 'OnTrack'
      red.pieces[0].trackPosition = 0 // Red's own entry square, already holding one Red pawn...
      blue.parkiller.corridorPosition = blue.parkiller.corridorLength
      blue.parkiller.trackPosition = 0 // ...and (correctly, PK4) an opposing Parkiller too

      const settings = defaultRuleSettings()
      const exitMove = getValidMoves(board, red, [red, blue], 5, settings).find((m) => m.kind === 'ExitYard')
      expect(exitMove).toBeTruthy() // the exit itself is never blocked outright - PC2.1's own obligation

      const result = applyMove(board, exitMove!, [red, blue], settings, true)

      expect(result.eliminatedByParkiller).toBe(true)
      expect(result.eliminatedByParkillerColor).toBe('Blue')
      expect(red.pieces[1].state).toBe('InYard') // the newly-exited pawn bounces straight back
      // Exactly the original two occupants remain - never three.
      expect(red.pieces[0].state).toBe('OnTrack')
      expect(red.pieces[0].trackPosition).toBe(0)
      expect(blue.parkiller.state).toBe('InPlay')
      expect(blue.parkiller.trackPosition).toBe(0)
    })

    // Client's own "Special Situations" guide, "PARKI ON THE STARTING SQUARE": two Parkis already
    // paired on the entry square, one of them this exiting pawn's own color, is a genuinely
    // different shape from the sibling test just above (an own *pawn* + a foreign Parki) - a pawn
    // joining its *own Parkiller* is protected by it and eliminates the foreign one, rather than
    // bouncing home itself. "Pawns cannot eliminate their own Parki" (same page) - only the
    // foreign one is ever a target here.
    it('exiting onto an entry square already holding own Parkiller + a foreign Parkiller eliminates the foreign one', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      red.parkiller.corridorPosition = red.parkiller.corridorLength
      red.parkiller.trackPosition = 0 // Red's own entry square, already holding Red's own Parkiller...
      blue.parkiller.corridorPosition = blue.parkiller.corridorLength
      blue.parkiller.trackPosition = 0 // ...paired with Blue's, a real "Two Parkis" barrier (safe square)

      const settings = defaultRuleSettings()
      const exitMove = getValidMoves(board, red, [red, blue], 5, settings).find((m) => m.kind === 'ExitYard')
      expect(exitMove).toBeTruthy()

      const result = applyMove(board, exitMove!, [red, blue], settings, false)

      expect(result.capturedParkillerColor).toBe('Blue')
      expect(result.eliminatedByParkiller).toBeFalsy() // the mover itself is protected, not bounced
      expect(blue.parkiller.state).toBe('Eliminated')
      expect(red.parkiller.state).toBe('InPlay') // pawns cannot eliminate their own Parki
      expect(red.parkiller.trackPosition).toBe(0)
      expect(red.pieces[0].state).toBe('OnTrack')
      expect(red.pieces[0].trackPosition).toBe(0)
    })

    // Client's own "Special Situations" guide: a foreign Parki already paired with a *third*
    // player's pawn (neither matching this exiting pawn's own color) is exposed exactly like two
    // different-colored opposing pawns already are (PC2.1) - the pawn loses, the Parkiller is
    // untouched, and this exit's own pawn safely takes its place alongside it.
    it('exiting onto an entry square already holding a foreign Parkiller + a third player\'s pawn eliminates the pawn, not the Parkiller', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      const green = createPlayerState('Green', board)
      blue.parkiller.corridorPosition = blue.parkiller.corridorLength
      blue.parkiller.trackPosition = 0 // Red's own entry square, already holding Blue's Parkiller...
      green.pieces[0].state = 'OnTrack'
      green.pieces[0].trackPosition = 0 // ...paired with Green's lone pawn (Barriers case 5, safe square)

      const settings = defaultRuleSettings()
      const exitMove = getValidMoves(board, red, [red, blue, green], 5, settings).find((m) => m.kind === 'ExitYard')
      expect(exitMove).toBeTruthy()

      const result = applyMove(board, exitMove!, [red, blue, green], settings, false)

      expect(result.capturedPiece).toBe(green.pieces[0])
      expect(result.capturedParkillerColor).toBeFalsy()
      expect(result.eliminatedByParkiller).toBeFalsy() // the mover safely takes green's place
      expect(green.pieces[0].state).toBe('InYard')
      expect(blue.parkiller.state).toBe('InPlay')
      expect(blue.parkiller.trackPosition).toBe(0)
      expect(red.pieces[0].state).toBe('OnTrack')
      expect(red.pieces[0].trackPosition).toBe(0)
    })

    it('an own pawn plus the player\'s own Parkiller already on the entry square blocks exit as an own barrier', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      red.pieces[0].state = 'OnTrack'
      red.pieces[0].trackPosition = 0
      red.parkiller.corridorPosition = red.parkiller.corridorLength
      red.parkiller.trackPosition = 0

      const settings = defaultRuleSettings()
      const moves = getValidMoves(board, red, [red], 5, settings)
      expect(moves.find((m) => m.kind === 'ExitYard')).toBeUndefined()
    })

    it('an opposing pawn plus that same opponent\'s own Parkiller on the entry square blocks exit as a foreign barrier', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      blue.pieces[0].state = 'OnTrack'
      blue.pieces[0].trackPosition = 0
      blue.parkiller.corridorPosition = blue.parkiller.corridorLength
      blue.parkiller.trackPosition = 0

      const settings = defaultRuleSettings()
      const moves = getValidMoves(board, red, [red, blue], 5, settings)
      expect(moves.find((m) => m.kind === 'ExitYard')).toBeUndefined()
    })

    it('a normal (non-exit) move cannot land on a square already holding a pawn and an opposing Parkiller', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      red.pieces[0].state = 'OnTrack'
      red.pieces[0].trackPosition = 5
      blue.parkiller.corridorPosition = blue.parkiller.corridorLength
      blue.parkiller.trackPosition = 5
      red.pieces[1].state = 'OnTrack'
      red.pieces[1].trackPosition = 3

      const settings = defaultRuleSettings()
      const moves = getValidMoves(board, red, [red, blue], 2, settings) // 3 -> 5
      expect(moves.find((m) => m.piece === red.pieces[1])).toBeUndefined()
    })

    it('a normal move cannot pass through a square already holding a pawn and an opposing Parkiller', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      red.pieces[0].state = 'OnTrack'
      red.pieces[0].trackPosition = 4
      blue.parkiller.corridorPosition = blue.parkiller.corridorLength
      blue.parkiller.trackPosition = 4
      red.pieces[1].state = 'OnTrack'
      red.pieces[1].trackPosition = 2

      const settings = defaultRuleSettings()
      const moves = getValidMoves(board, red, [red, blue], 3, settings) // 2 -> 5, crossing square 4
      expect(moves.find((m) => m.piece === red.pieces[1])).toBeUndefined()
    })

    // Reported directly, via a stress test simulating full games (not from a specific screenshot -
    // this one surfaced from running many complete bot-vs-bot games and watching for exactly this
    // invariant): the mirror of the "own pawn + opposing Parkiller" case above. Gold's own Parkiller
    // was already sharing a safe square with a lone opposing (Purple) pawn - a real, full "Parki +
    // different-color pawn" barrier (BARRIERS rules page, case 5) - when Gold's own *second* pawn
    // then exited onto that same square. getValidMoves' own exit-blocking check never blocked this
    // (correctly - PC2.1 only blocks on 2 *own* pieces or a *foreign* barrier, neither of which this
    // is), but applyMove's own "joining an own piece already there captures the opponent" resolution
    // used to only ever count *pawns* toward "own pieces at the destination" - it never recognized
    // the player's own Parkiller as one of them, so Purple's pawn was never captured, leaving 3
    // pieces stacked on the square (Gold's new pawn, Gold's own Parkiller, and Purple's pawn) instead
    // of correctly resolving back down to 2.
    it('exiting to join a square already holding the own Parkiller and a lone opposing pawn captures that pawn, never a 3-stack', () => {
      const board = buildTestBoard()
      const red = createPlayerState('Red', board)
      const blue = createPlayerState('Blue', board)
      red.parkiller.corridorPosition = red.parkiller.corridorLength
      red.parkiller.trackPosition = 0 // Red's own entry square, already holding Red's own Parkiller...
      blue.pieces[0].state = 'OnTrack'
      blue.pieces[0].trackPosition = 0 // ...and (correctly, PK4) a lone opposing pawn too

      const settings = defaultRuleSettings()
      const exitMove = getValidMoves(board, red, [red, blue], 5, settings).find((m) => m.kind === 'ExitYard')
      expect(exitMove).toBeTruthy() // never blocked outright - matches the mirror case above

      const result = applyMove(board, exitMove!, [red, blue], settings, true)

      expect(result.capturedPiece).toBe(blue.pieces[0])
      expect(blue.pieces[0].state).toBe('InYard')
      expect(red.pieces[0].state).toBe('OnTrack') // the newly-exited pawn stays put
      expect(red.pieces[0].trackPosition).toBe(0)
      expect(red.parkiller.trackPosition).toBe(0) // untouched
      // Exactly 2 occupants remain (Red's new pawn + Red's own Parkiller) - never three.
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
      defender.parkiller.corridorPosition = defender.parkiller.corridorLength
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
      defender.parkiller.corridorPosition = defender.parkiller.corridorLength
      defender.parkiller.trackPosition = 10

      const settings = defaultRuleSettings()
      const sumMove = getValidMoves(board, attacker, [attacker, defender], 3, settings, 'sum').find((m) => m.piece === attacker.pieces[0])!

      expect(wouldCapture(board, sumMove, [attacker, defender], true)).toBe(false)
    })
  })
})
