import { describe, expect, it } from 'vitest'
import type { BoardData } from '../src/core/board/boardData'
import type { DiceLike } from '../src/core/dice'
import { createPlayerState } from '../src/core/gameFlow/playerState'
import { TurnManager, type DiceRoll, type RewardGrant } from '../src/core/gameFlow/turnManager'
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

// A 20-square reward can't fit as a plain TrackMove on the small test board above (its longest
// possible distanceToHomeEntrance is 19), so the reward-chaining test needs more room to land a
// second capture without also cutting into the corridor.
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

describe('TurnManager - two-dice rulebook flow', () => {
  it('offers a die-A move and a die-B move for two different pieces on the same roll', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'InHomeCorridor'
    red.pieces[0].corridorPosition = 1 // +4 (die A) lands exactly on the finish square (index 5)
    red.pieces[1].state = 'InHomeCorridor'
    red.pieces[1].corridorPosition = 3 // +2 (die B) lands exactly on the finish square; +4 overshoots

    const dice = new ScriptedDice([4, 2, 1])
    const settings = defaultRuleSettings()
    const manager = new TurnManager(board, [red, blue], settings, dice)

    let offered: DiceRoll | null = null
    manager.diceRolled.on((roll) => (offered = roll))
    let latestMoves: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((m) => (latestMoves = m))

    manager.requestRoll()

    expect(offered).toEqual({ dieA: 4, dieB: 2, blackDie: 1 })
    // Three options, not two: piece0's own die B (1 -> 3) happens to land exactly on piece1's own
    // square, which - now that a corridor square legally holds two of a color's own pieces (a real
    // corridor barrier, see parchisRules.test.ts) - is a genuinely legal third choice, not a
    // collision to avoid. Same "keeps every distinct option, doesn't silently collapse" design this
    // game already applies to any piece reachable by more than one die.
    expect(latestMoves).toHaveLength(3)
    const forPiece0ViaA = latestMoves.find((m) => m.piece === red.pieces[0] && m.diceSource === 'dieA')
    const forPiece0ViaB = latestMoves.find((m) => m.piece === red.pieces[0] && m.diceSource === 'dieB')
    const forPiece1 = latestMoves.find((m) => m.piece === red.pieces[1])
    expect(forPiece0ViaA).toMatchObject({ diceSource: 'dieA', amount: 4, kind: 'FinishMove' })
    expect(forPiece0ViaB).toMatchObject({ diceSource: 'dieB', amount: 2, kind: 'CorridorMove', resultingCorridorPosition: 3 })
    expect(forPiece1).toMatchObject({ diceSource: 'dieB', amount: 2, kind: 'FinishMove' })

    // Spend die A on piece 0 explicitly (disambiguating from its own die-B option) - die B should
    // still be offered afterward for piece 1.
    manager.submitMove(red.pieces[0], 4)
    expect(red.pieces[0].state).toBe('Finished')
    expect(latestMoves).toHaveLength(1)
    expect(latestMoves[0].piece).toBe(red.pieces[1])
    expect(latestMoves[0].diceSource).toBe('dieB')

    manager.submitMove(red.pieces[1])
    expect(red.pieces[1].state).toBe('Finished')
  })

  it('offers both dice as separate choices for a piece reachable by either, and moves by whichever one is picked', () => {
    // Reported directly ("SE DEBE PODER ELEGIR CON CUAL DE LOS DOS DADOS SE MUEVE EL PEON QUE SE
    // DESEE"): the player never got an actual choice here before - dieA's own move for this piece
    // silently won, dieB's own (different-destination) option for the exact same piece was dropped
    // outright instead of being offered alongside it.
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0

    const dice = new ScriptedDice([3, 4, 1]) // neither die is the exit roll (5) - no exit-lock in play
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let latestMoves: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((m) => (latestMoves = m))

    manager.requestRoll()

    // dieA alone (3), dieB alone (4), and their sum (7, since neither die is exit-locked and this
    // is the only piece in play to spend it on) are all distinct, legitimately offered choices.
    const forPiece0 = latestMoves.filter((m) => m.piece === red.pieces[0])
    expect(forPiece0.map((m) => m.amount).sort((a, b) => a - b)).toEqual([3, 4, 7])

    // Deliberately pick the die that is NOT simply the first one TurnManager happened to compute -
    // proves submitMove's own amount disambiguation actually picks the requested option, not just
    // whichever one .find() would have hit first.
    manager.submitMove(red.pieces[0], 4)
    expect(red.pieces[0].trackPosition).toBe(4)
  })

  it('exits the yard on a single die showing the exit roll', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    const dice = new ScriptedDice([5, 1, 1])
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
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    const dice = new ScriptedDice([2, 3, 1]) // neither die is 5, but 2+3=5
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
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0

    const dice = new ScriptedDice([2, 2, 1])
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
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0

    const dice = new ScriptedDice([2, 2, 1, 3, 3, 1, 4, 4, 1])
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
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'InHomeCorridor'
    red.pieces[0].corridorPosition = 0

    // Two doubles of 1,1 move the piece from corridor position 0 to 4 (one square short of the
    // finish at index 5), so it's still InHomeCorridor - not Finished - when the third double
    // (1,1 again) hits the elimination check. What that third roll's dice do afterward isn't the
    // point of this test, only that the exemption fires instead of sending the piece to the yard.
    const dice = new ScriptedDice([1, 1, 1, 1, 1, 1, 1, 1, 1])
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

describe('TurnManager - mandatory departure (PC2.1)', () => {
  it("a die matching the exit roll can only exit a yard piece, never reassigned to a different piece - the other die stays free in either order", () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 2 // could also move +5 -> 7, but that's not a capture

    const dice = new ScriptedDice([5, 3, 1]) // dieA=5 (the exit roll), dieB=3
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let latestMoves: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((m) => (latestMoves = m))
    manager.requestRoll()

    // die A (5) is locked to exiting a yard piece - piece0's own +5 track move is not offered
    expect(latestMoves.find((m) => m.piece === red.pieces[0] && m.diceSource === 'dieA')).toBeUndefined()
    expect(latestMoves.filter((m) => m.kind === 'ExitYard')).toHaveLength(3) // pieces 1,2,3 still in the yard

    // die B (3) stays completely free - piece0 can move with it before the mandatory exit resolves
    const dieBMove = latestMoves.find((m) => m.piece === red.pieces[0] && m.diceSource === 'dieB')
    expect(dieBMove?.resultingTrackPosition).toBe(5)
    manager.submitMove(red.pieces[0])
    expect(red.pieces[0].trackPosition).toBe(5)

    // only the mandatory exit remains for the last die
    expect(latestMoves.length).toBeGreaterThan(0)
    expect(latestMoves.every((m) => m.kind === 'ExitYard')).toBe(true)
    manager.submitMove(red.pieces[1])
    expect(red.pieces[1].state).toBe('OnTrack')
    expect(red.pieces[1].trackPosition).toBe(0)
  })

  // A TurnManager-level "both eliminated" integration test turned out very hard to construct
  // cleanly: the capture reward is mandatory to claim immediately (PC6.2) before the second
  // exit's own obligation can resume, and any piece able to receive that reward without moving
  // the barrier-forming piece itself tends to have its own long reward path wrap back through the
  // entry square (still holding 2 pieces at that point) and get blocked by the ordinary barrier-
  // transit rule (PC2.4) - a real rule interaction, not a bug. The underlying single-exit rule
  // itself (eliminate whichever of two different-colored opponents arrived later) is covered
  // directly at the parchisRules level instead - see "two *different-colored* opponents on the
  // entry square..." in parchisRules.test.ts.

  it('a double matching the exit roll forces both yard pieces out across the two dice, not just one', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)

    const dice = new ScriptedDice([5, 5, 1]) // double-five, all 4 red pieces start in the yard
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let latestMoves: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((m) => (latestMoves = m))
    manager.requestRoll()

    expect(latestMoves.length).toBeGreaterThan(0)
    expect(latestMoves.every((m) => m.kind === 'ExitYard')).toBe(true)

    manager.submitMove(red.pieces[0])
    expect(red.pieces[0].state).toBe('OnTrack')

    // the second die is still locked to exiting one of the remaining yard pieces
    expect(latestMoves.length).toBeGreaterThan(0)
    expect(latestMoves.every((m) => m.kind === 'ExitYard')).toBe(true)

    manager.submitMove(red.pieces[1])
    expect(red.pieces[1].state).toBe('OnTrack')
    expect(red.pieces[0].trackPosition).toBe(0)
    expect(red.pieces[1].trackPosition).toBe(0)
  })

  // Reported directly ("si sale 5 y quedan peones en el refugio deben salir" - if a 5 comes up and
  // there are still pawns in the shelter, they must come out): PC2.1 names the sum as an equally
  // valid exit trigger ("a die shows a 5, or the sum is 5"), but the single-die-only checks above
  // (dieAHasExit/dieBHasExit) missed a roll like 4+1 entirely - neither die is individually 5, so
  // both were previously left completely free and a player could dodge the exit outright by moving
  // two other already-in-play pieces with the 4 and the 1, never touching the sum-only exit at all.
  it('a sum-only exit roll (neither die individually the exit roll) still locks both dice to the exit, not just the sum', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 2 // dieA=4 alone would move it to 6, dieB=1 alone to 3 - neither is a capture

    const dice = new ScriptedDice([4, 1, 1]) // neither die is 5, but 4+1=5 (the exit roll)
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let latestMoves: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((m) => (latestMoves = m))
    manager.requestRoll()

    // Neither die individually offers a move for the already-in-play piece - both are locked to the
    // sum-only exit, exactly like a single die's own exit lock already restricts that one die.
    expect(latestMoves.some((m) => m.piece === red.pieces[0])).toBe(false)
    expect(latestMoves.length).toBeGreaterThan(0)
    expect(latestMoves.every((m) => m.kind === 'ExitYard' && m.diceSource === 'sum')).toBe(true)

    const result = manager.submitMove(red.pieces[1])
    expect(result).not.toBeNull()
    expect(red.pieces[1].state).toBe('OnTrack')
    expect(red.pieces[1].trackPosition).toBe(0)
  })

  // Client's own "SPECIAL STARTING SQUARE RULE" infographic: two pawns of different colors already
  // on the entry square, neither a real barrier (PC2.1's own "exposed foreign pair" exception,
  // already covered in isolation by parchisRules.test.ts's own sibling test) - a plain single 5
  // eliminates whichever arrived later. This locks in the *double* 5 half end to end: with two
  // shelter pawns, the first exit eliminates the later arrival (same as a single 5 would), and the
  // second exit - joining an own pawn already there, the existing "further own pawn captures the
  // lone opponent" rule everywhere else in this file already relies on - eliminates the other one
  // too, with no special-casing needed for this to already work correctly.
  it('two different-colored foreign pawns on the entry square, double 5 with two shelter pawns: both eliminated', () => {
    // A short home-corridor distance, not buildBigTestBoard()'s - the first capture's own 20-square
    // reward would otherwise actually be spendable, moving pieces[0] away from the entry square
    // before the second exit even happens and defeating the very "further own pawn joins" mechanic
    // this test means to check. Forcing the reward to forfeit (nothing in play can use 20 *or* 10)
    // keeps pieces[0] planted exactly where the second exit needs it.
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
    const gold = createPlayerState('Gold', board) // no lane defined on this board for Gold
    const blue = createPlayerState('Blue', board)
    gold.parkiller.state = 'Eliminated' // keep Gold's lane-less default Parkiller out of the way
    gold.pieces[0].state = 'OnTrack'
    gold.pieces[0].trackPosition = 0
    gold.pieces[0].arrivedAt = 1 // arrived first - protected by the tie-break on the first exit
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 0
    blue.pieces[0].arrivedAt = 2 // arrived later - goes first

    const dice = new ScriptedDice([5, 5, 1])
    const manager = new TurnManager(board, [red, gold, blue], defaultRuleSettings(), dice)
    let latestMoves: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((m) => (latestMoves = m))

    manager.requestRoll()
    const r1 = manager.submitMove(red.pieces[0])

    expect(r1?.capturedPiece).toBe(blue.pieces[0])
    expect(blue.pieces[0].state).toBe('InYard')
    expect(gold.pieces[0].state).toBe('OnTrack') // not yet - only the first exit has happened

    const secondExit = latestMoves.find((m) => m.kind === 'ExitYard')
    expect(secondExit).toBeTruthy()
    const r2 = manager.submitMove(secondExit!.piece)

    expect(r2?.capturedPiece).toBe(gold.pieces[0])
    expect(gold.pieces[0].state).toBe('InYard')
    expect(red.pieces[0].state).toBe('OnTrack')
    expect(red.pieces[0].trackPosition).toBe(0)
    expect(secondExit!.piece.state).toBe('OnTrack')
    expect(secondExit!.piece.trackPosition).toBe(0)
  })
})

describe('TurnManager - PC 3/PC 4/PC 5 rewards', () => {
  // Confirmed directly in the client's own corrected rulebook (rules.pdf, "Bonus" pages, present
  // on every one of Pawn Capture/Parki Elimination/Bonuses): "Choose one: Move one Pawn 20 spaces.
  // OR Move one Pawn 10 spaces and another pawn 10 spaces." Not a forced split into two independent
  // 10s (the previous version of this test, and this file's own history before it) - a genuine
  // choice, with the always-split path being one valid way to use it, not the only one.
  it('capturing an opponent grants a 20-square reward, offered as a choice between one pawn moving 20 or two different pawns moving 10 each', () => {
    const board = buildBigTestBoard() // plenty of track room so a 20-square jump never nears home
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 0
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 8

    const dice = new ScriptedDice([3, 1, 1])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    const grants: RewardGrant[] = []
    manager.rewardOffered.on((g) => grants.push(g))
    let latestMoves: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((m) => (latestMoves = m))

    manager.requestRoll()
    // useTurnManager's chooseMove reads this return value directly (not just the moveApplied event)
    // to know which piece to keep rendering at the capture square until the animation finishes.
    const submitResult = manager.submitMove(red.pieces[0]) // 5 -> 8 (die A = 3), lands on and captures Blue's piece
    expect(submitResult?.capturedPiece).toBe(blue.pieces[0])
    expect(blue.pieces[0].state).toBe('InYard')

    // A single 20-square grant, not two independent 10s.
    expect(grants).toEqual([{ amount: 20, reason: 'capture' }])
    // Both amounts offered together for whichever piece(s) can reach them - pieces[1] (at 0) can
    // reach both 10 and 20 cleanly on this board.
    expect(latestMoves.some((m) => m.piece === red.pieces[1] && m.amount === 20 && m.diceSource === 'reward')).toBe(true)
    expect(latestMoves.some((m) => m.piece === red.pieces[1] && m.amount === 10 && m.diceSource === 'reward')).toBe(true)

    // Picks the split path: only the 10-amount option for pieces[1].
    manager.submitMove(red.pieces[1], 10) // spends half the grant: track 0 -> 10
    expect(red.pieces[1].trackPosition).toBe(10)

    // The remaining 10 is re-offered - excluding pieces[1] itself ("another pawn", not the same one
    // taking both halves).
    expect(grants).toEqual([
      { amount: 20, reason: 'capture' },
      { amount: 10, reason: 'capture' },
    ])
    expect(latestMoves.some((m) => m.piece === red.pieces[1])).toBe(false)
    expect(latestMoves.every((m) => m.amount === 10)).toBe(true)
    expect(latestMoves.some((m) => m.piece === red.pieces[0])).toBe(true)

    manager.submitMove(red.pieces[0]) // spends the remaining 10: track 8 -> 18
    expect(red.pieces[0].trackPosition).toBe(18)
    // Nothing left owed - exactly the two grants above, no third.
    expect(grants).toHaveLength(2)
  })

  it('capturing an opponent and taking the full 20 on one pawn resolves the whole grant in one move, no remainder', () => {
    const board = buildBigTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 8

    const dice = new ScriptedDice([3, 1, 1])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    const grants: RewardGrant[] = []
    manager.rewardOffered.on((g) => grants.push(g))

    manager.requestRoll()
    manager.submitMove(red.pieces[0]) // 5 -> 8, captures blue.pieces[0]
    expect(grants).toEqual([{ amount: 20, reason: 'capture' }])

    manager.submitMove(red.pieces[0], 20) // takes the full grant in one move: 8 -> 28
    expect(red.pieces[0].trackPosition).toBe(28)
    // No remainder offered - the whole 20 was claimed at once.
    expect(grants).toHaveLength(1)
  })

  // Reported directly ("장벽이 형성되였을때 주사위가 더블이 되지도않앗는데 장벽에서 나오는경황이있었다" -
  // a piece came out of a barrier even though the dice weren't a double): a reward can be granted on
  // any roll, completely independent of whether that roll was a double - the rulebook's own "OPENING
  // A BARRIER" page names exactly two ways to open one (a double, or an opposing Parki), and a bonus
  // move spending accumulated reward squares is neither, so it must never be able to move a piece
  // sitting in the player's own barrier, on a double roll or not.
  it('a reward move never offers a piece sitting in the player own barrier, even on a non-double roll', () => {
    const board = buildBigTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 12
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 12 // pieces[0] and pieces[1] form a barrier at 12
    red.pieces[2].state = 'OnTrack'
    red.pieces[2].trackPosition = 5 // the one that actually captures
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 8

    const dice = new ScriptedDice([3, 4, 1]) // not a double - 3 and 4
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let latestMoves: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((m) => (latestMoves = m))

    manager.requestRoll()
    const result = manager.submitMove(red.pieces[2]) // 5 -> 8 (dieA=3), captures blue.pieces[0]
    expect(result?.capturedPiece).toBe(blue.pieces[0])

    // The reward is offered, but pieces[0]/pieces[1] - still locked in their own barrier on this
    // non-double roll - must not appear as candidates for it at all, for either amount.
    expect(latestMoves.some((m) => m.piece === red.pieces[0])).toBe(false)
    expect(latestMoves.some((m) => m.piece === red.pieces[1])).toBe(false)
    // pieces[2] itself (not barrier-locked) still gets offered normally.
    expect(latestMoves.some((m) => m.piece === red.pieces[2])).toBe(true)

    // The barrier itself really is still there - unaffected, still stacked at 12.
    expect(red.pieces[0].trackPosition).toBe(12)
    expect(red.pieces[1].trackPosition).toBe(12)
  })

  it('finishing a piece grants a 10-square reward', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'InHomeCorridor'
    red.pieces[0].corridorPosition = 3 // +2 lands exactly on the finish square (corridor index 5)
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 0

    const dice = new ScriptedDice([2, 1, 1])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let rewardGrant: RewardGrant | null = null
    manager.rewardOffered.on((g) => (rewardGrant = g))

    manager.requestRoll()
    manager.submitMove(red.pieces[0])

    expect(red.pieces[0].state).toBe('Finished')
    expect(rewardGrant).toEqual({ amount: 10, reason: 'finish' })
  })

  it('a reward move that itself captures chains another reward on top (PC 5)', () => {
    const board = buildBigTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 1
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 8
    blue.pieces[1].state = 'OnTrack'
    blue.pieces[1].trackPosition = 18 // exactly where pieces[0] lands claiming the remainder below

    const dice = new ScriptedDice([3, 1, 1])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    const grants: RewardGrant[] = []
    manager.rewardOffered.on((g) => grants.push(g))

    manager.requestRoll()
    manager.submitMove(red.pieces[0]) // 5 -> 8, captures blue.pieces[0] - queues a 20-square grant
    expect(blue.pieces[0].state).toBe('InYard')

    // Splits the grant: pieces[1] takes only the 10-amount half (1 -> 11, no capture there).
    manager.submitMove(red.pieces[1], 10)
    expect(red.pieces[1].trackPosition).toBe(11)

    // The remaining 10 is re-offered excluding pieces[1] - pieces[0] (still at 8) takes it instead,
    // landing exactly on blue.pieces[1] and capturing it.
    manager.submitMove(red.pieces[0])
    expect(red.pieces[0].trackPosition).toBe(18)
    expect(blue.pieces[1].state).toBe('InYard')

    // The original 20 (split into two offerings), plus a fresh 20 queued by this second capture -
    // proves a capture made *during* an existing reward chain adds onto it rather than replacing it
    // or leaving the turn stuck once the original grant runs out.
    expect(grants).toEqual([
      { amount: 20, reason: 'capture' },
      { amount: 10, reason: 'capture' },
      { amount: 20, reason: 'capture' },
    ])
  })

  it('forfeits the reward when no piece already in play can use it (PC 5)', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 14
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 17
    // red.pieces[1..3] stay InYard - a reward can never move a piece out of the shelter (PC 5), and
    // red.pieces[0] itself would overshoot its own finish (2 to its home entrance + 6-square
    // corridor = 8, less than either the full 20 or its split 10), so nothing qualifies for either
    // option and the whole grant is forfeited as one unit.
    const dice = new ScriptedDice([3, 1, 1])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    const forfeited: RewardGrant[] = []
    manager.rewardForfeited.on((g) => forfeited.push(g))
    let offered: RewardGrant | null = null
    manager.rewardOffered.on((g) => (offered = g))

    manager.requestRoll()
    manager.submitMove(red.pieces[0]) // 14 -> 17, captures blue.pieces[0]

    expect(blue.pieces[0].state).toBe('InYard')
    expect(offered).toBeNull()
    expect(forfeited).toEqual([{ amount: 20, reason: 'capture' }])
  })

  it('locks a capturing piece to its capturing move, but leaves a different, non-capturing piece completely free (PC3/PK8)', () => {
    // Verified directly against the reference implementation (activarFichasMovibles()/wouldComer()
    // in Parkiller_GameMaker-main): mandatory capture is per-piece, not a blanket restriction across
    // the whole roll - a piece that could capture can't dodge into a non-capturing move for itself,
    // but that's the only restriction. The rulebook's own prose describes exactly this escape hatch
    // ("if you want to avoid this, you can move another pawn with the matching number and then the
    // pawn in question") - a *different* piece stays completely free to use either die (or the sum),
    // including the very die that would have captured. An earlier version of this test asserted the
    // opposite (any capture anywhere forces every other piece into a capturing move too) - that was
    // the actual bug, not this one.
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 10
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 3 // dieA=3 moves red.pieces[0] 0 -> 3, capturing it

    // dieB=4 (not 2): the original 3+2 summed to the exit roll (5) and, with yard pieces still
    // present, unintentionally triggered the sum-exit obligation this same file tests separately
    // below - collapsing this test's own unrelated "other piece stays free" case down to nothing.
    // dieB=4 just moves red.pieces[1] 10 -> 14, no capture, sum 3+4=7 (not the exit roll).
    const dice = new ScriptedDice([3, 4, 1])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let offered: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((moves) => (offered = moves))

    manager.requestRoll()

    const forCapturingPiece = offered.filter((m) => m.piece === red.pieces[0])
    const forOtherPiece = offered.filter((m) => m.piece === red.pieces[1])
    expect(forCapturingPiece).toHaveLength(1)
    expect(forCapturingPiece[0].resultingTrackPosition).toBe(3)
    expect(forOtherPiece.length).toBeGreaterThan(1)
  })

  it('lets a capture be avoided by redirecting the capturing die elsewhere and jumping past with the other die (PC3/PK8)', () => {
    // The rulebook's own prose, and the reference implementation's tutorial message
    // ("Si con un peón tienes posibilidad de comer, debes comer obligadamente, excepto que elijas
    // mover otra pieza" - if a pawn of yours could capture, you must capture, unless you choose to
    // move a different piece): spending the capturing die (3) on a *different* piece first, then
    // using the *other* die (6, deliberately not 5 - the exit roll, which would otherwise lock this
    // die to ExitYard-or-capture only and muddy what this test is actually isolating) on the
    // near-capture piece lands it past the opponent's square (6, not 3) instead of capturing - no
    // elimination, no reward, and the opponent stays exactly where it was.
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 0 // dieA=3 would capture blue.pieces[0]; dieB=6 jumps past it to 6
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 10
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 3

    const dice = new ScriptedDice([3, 6, 1])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    manager.requestRoll()
    manager.submitMove(red.pieces[1], 3) // spends dieA=3 on a different piece - not a capture

    // red.pieces[0] is no longer locked to the capture - dieB=6 is now offered on it, landing past
    // (not on) blue.pieces[0]'s square.
    manager.submitMove(red.pieces[0], 6)

    expect(red.pieces[0].trackPosition).toBe(6)
    expect(blue.pieces[0].state).toBe('OnTrack')
    expect(blue.pieces[0].trackPosition).toBe(3)
  })
})

describe('TurnManager - mandatory barrier removal on doubles (PK9.1)', () => {
  it('restricts a double roll to breaking an existing own barrier, not other legal moves', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 5 // own barrier at 5, pieces[0] + pieces[1]
    red.pieces[2].state = 'OnTrack'
    red.pieces[2].trackPosition = 0 // otherwise also free to move by 3 - must NOT be offered

    const dice = new ScriptedDice([3, 3, 1])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let offered: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((moves) => (offered = moves))

    manager.requestRoll()

    expect(offered).toHaveLength(2)
    expect(offered.map((m) => m.piece)).toEqual(expect.arrayContaining([red.pieces[0], red.pieces[1]]))
    expect(offered.some((m) => m.piece === red.pieces[2])).toBe(false)
  })

  it('frees the second (identical-value) die once the first has already broken the barrier', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 5
    red.pieces[2].state = 'OnTrack'
    red.pieces[2].trackPosition = 0

    const dice = new ScriptedDice([3, 3, 1])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let offered: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((moves) => (offered = moves))

    manager.requestRoll()
    manager.submitMove(red.pieces[0]) // 5 -> 8, breaks the barrier - re-offers for the second die

    // Re-checked fresh (not "already used this roll") - once the barrier is actually gone, the
    // second die is free for anything legal, including the piece excluded a moment ago.
    expect(offered.some((m) => m.piece === red.pieces[2])).toBe(true)
  })

  // Confirmed directly in the client's own rulebook, "Opening a Barrier" page: "If you open a
  // barrier by rolling a double, you cannot use that same double to create another barrier...
  // Both pawns must finish on different spaces. You cannot recreate the barrier using the same
  // double." The previous test only confirmed the second die becomes free again, not that "free"
  // still excludes reforming the exact barrier that was just broken.
  it('does not let the same double put the barrier back together on the square it was just broken from', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 5 // own barrier at 5, pieces[0] + pieces[1]
    red.pieces[2].state = 'OnTrack'
    red.pieces[2].trackPosition = 0

    const dice = new ScriptedDice([3, 3, 1])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let offered: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((moves) => (offered = moves))

    manager.requestRoll()
    manager.submitMove(red.pieces[0]) // 5 -> 8, breaks the barrier

    // pieces[1] is still sitting at 5 and the second die is also worth 3 - landing it on 8 would
    // put it right back together with pieces[0], recreating the exact barrier just broken.
    expect(offered.some((m) => m.piece === red.pieces[1] && m.resultingTrackPosition === 8)).toBe(false)
    // pieces[2] is unrelated to that barrier - still completely free to use the second die normally.
    expect(offered.some((m) => m.piece === red.pieces[2] && m.resultingTrackPosition === 3)).toBe(true)
  })

  it('waives the obligation when the barrier truly cannot be broken this roll ("unless movement is impossible")', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 5 // own barrier at 5
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 8
    blue.pieces[1].state = 'OnTrack'
    blue.pieces[1].trackPosition = 8 // an opposing barrier blocks the only square this double reaches
    red.pieces[2].state = 'OnTrack'
    red.pieces[2].trackPosition = 0 // otherwise free to move by 3

    const dice = new ScriptedDice([3, 3, 1])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let offered: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((moves) => (offered = moves))

    manager.requestRoll()

    // Neither barrier pawn can legally move at all (blocked) - the obligation is waived rather than
    // forcing a false "no moves possible", so whatever else was legal is offered normally.
    expect(offered.some((m) => m.piece === red.pieces[2])).toBe(true)
  })

  // PC2.4's own rulebook text: a double forces the player to open a barrier "including those in
  // the finish zone" - the obligation isn't track-only. Same restriction as the very first test in
  // this block, just with the barrier sitting in the player's own home corridor instead.
  it('also restricts a double roll to breaking an existing own barrier in the home corridor', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'InHomeCorridor'
    red.pieces[0].corridorPosition = 1
    red.pieces[1].state = 'InHomeCorridor'
    red.pieces[1].corridorPosition = 1 // own corridor barrier, pieces[0] + pieces[1]
    red.pieces[2].state = 'OnTrack'
    red.pieces[2].trackPosition = 0 // otherwise also free to move by 2 - must NOT be offered

    const dice = new ScriptedDice([2, 2, 1])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let offered: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((moves) => (offered = moves))

    manager.requestRoll()

    expect(offered).toHaveLength(2)
    expect(offered.map((m) => m.piece)).toEqual(expect.arrayContaining([red.pieces[0], red.pieces[1]]))
    expect(offered.some((m) => m.piece === red.pieces[2])).toBe(false)
  })

  // Reported directly by the client, with screen recordings ("EMPIEZA ASI Y AL FINAL ES ABSURDO QUE
  // EL PEON SE 'SUICIDE', DEBE MOVER OTRO PEON" / "en esta situación salir es obligatorio y la
  // ficha que sale es eliminada. No hay opción para que avance la que forma barrera con el Parki"):
  // a pawn sharing a square with the player's *own* Parkiller is just as real an "own barrier" as
  // two own pawns (occupantsOnTrackSquare already treats it that way for blocking everyone else's
  // passage - see parchisRules.ts) but ownBarrierTrackPosition used to only ever scan player.pieces,
  // so this pairing was structurally invisible to PK9.1's double-break priority. A double that also
  // happened to equal the exit roll fell through to the plain exit lock instead, forcing every yard
  // pawn out with no way to move the pawn that should have broken its barrier with the Parkiller -
  // and if that forced exit then landed somewhere fatal, the player had no way to avoid it at all.
  it('a double matching the exit roll still prioritizes breaking a pawn+own-Parkiller barrier over forcing a yard exit', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5
    red.parkiller.corridorPosition = red.parkiller.corridorLength
    red.parkiller.trackPosition = 6 // the black die (1, below) walks it onto 5, joining pieces[0] -
    // the black die resolves before offerMoves() each roll, so this is what a same-roll-formed
    // pawn+Parkiller barrier actually looks like, not a pre-placed one the black die would just
    // immediately walk back off of.
    // pieces[1..3] stay InYard - a plain exit-lock (without the fix) would force them all out.

    const settings = { ...defaultRuleSettings(), exitRoll: 5 }
    const dice = new ScriptedDice([5, 5, 1]) // double and exit roll, blackDie=1 forms the barrier
    const manager = new TurnManager(board, [red, blue], settings, dice)

    let offered: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((moves) => (offered = moves))

    manager.requestRoll()

    // Only the barrier-break move for pieces[0] is offered - no yard piece gets force-exited while
    // an own pawn+Parkiller barrier still stands.
    expect(offered.every((m) => m.piece === red.pieces[0])).toBe(true)
    expect(offered.some((m) => m.kind === 'ExitYard')).toBe(false)
    expect(offered.some((m) => m.piece === red.pieces[0] && m.kind === 'TrackMove')).toBe(true)
  })
})

// Reported directly ("장벽 안에 있는 말이 어떤 숫자가 나오든 자동으로 장벽에서 나올 수 있는 규칙은
// 아닙니다" - a piece in a barrier does NOT automatically come out no matter what number comes up):
// the client's own corrected rulebook (rules.pdf, "OPENING A BARRIER") states "THERE ARE TWO WAYS
// TO OPEN A BARRIER" - a double, or an opposing Parki - and that a barrier "blocks the path"
// outright otherwise. A normal (non-double) roll previously moved a barrier piece exactly like any
// other piece; per this page, it should have *no* legal move for either barrier piece at all.
describe('TurnManager - a normal roll cannot move a piece out of its own barrier', () => {
  it('offers no moves for either barrier piece on a non-double roll, only for a free third piece', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 5 // own barrier at 5, pieces[0] + pieces[1] - locked in place
    red.pieces[2].state = 'OnTrack'
    red.pieces[2].trackPosition = 0 // free to move normally - not part of the barrier

    const dice = new ScriptedDice([3, 4, 1]) // not a double
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let offered: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((moves) => (offered = moves))

    manager.requestRoll()

    expect(offered.some((m) => m.piece === red.pieces[0])).toBe(false)
    expect(offered.some((m) => m.piece === red.pieces[1])).toBe(false)
    expect(offered.some((m) => m.piece === red.pieces[2])).toBe(true)
  })

  // Same lockout, but the barrier is a pawn sharing its square with the player's own Parkiller
  // instead of a second pawn - see ownBarrierTrackPosition's own doc comment on why this pairing
  // counts as a real own barrier just like two own pawns do.
  it('also locks a pawn sharing its square with the player own Parkiller on a non-double roll', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5
    red.parkiller.corridorPosition = red.parkiller.corridorLength
    red.parkiller.trackPosition = 6 // this roll's blackDie (1) walks it onto 5, joining pieces[0]
    red.pieces[2].state = 'OnTrack'
    red.pieces[2].trackPosition = 0 // free to move normally - not part of the barrier

    const dice = new ScriptedDice([3, 4, 1]) // not a double
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let offered: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((moves) => (offered = moves))

    manager.requestRoll()

    expect(red.parkiller.trackPosition).toBe(5)
    expect(offered.some((m) => m.piece === red.pieces[0])).toBe(false)
    expect(offered.some((m) => m.piece === red.pieces[2])).toBe(true)
  })

  it('loses the roll outright when the only pieces in play are locked in a barrier', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 5 // own barrier - the only two pieces in play, both locked

    const dice = new ScriptedDice([3, 4, 1]) // not a double, and neither is the exit roll
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let notPossible = false
    let reason: string | null = null
    manager.moveNotPossible.on((r) => {
      notPossible = true
      reason = r
    })
    let offered: import('../src/core/rules/moveOption').MoveOption[] | null = null
    manager.moveChoicesReady.on((moves) => (offered = moves))

    manager.requestRoll()

    expect(notPossible).toBe(true)
    // See MoveNotPossibleReason's own doc comment - GameBoardScreen shows a specific "barrier
    // locked" message only when a real candidate move existed and got excluded for sitting in the
    // barrier, which is exactly this scenario (both pieces in play have a barrier-eligible move).
    expect(reason).toBe('barrier')
    expect(offered).toBeNull()
    expect(red.pieces[0].trackPosition).toBe(5)
    expect(red.pieces[1].trackPosition).toBe(5)
  })

  it('reports "none", not "barrier", when nothing in play could use the roll at all', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    // Every Red piece stays in the yard - createPlayerState's own default state.

    const dice = new ScriptedDice([2, 4, 1]) // neither die, nor their sum, is the exit roll (5)
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let reason: string | null = null
    manager.moveNotPossible.on((r) => (reason = r))

    manager.requestRoll()

    expect(reason).toBe('none')
  })

  it('still allows every other piece to move normally when no barrier exists', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5 // alone - not a barrier

    const dice = new ScriptedDice([3, 4, 1])
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let offered: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((moves) => (offered = moves))

    manager.requestRoll()

    expect(offered.some((m) => m.piece === red.pieces[0])).toBe(true)
  })

  // Reported directly, via a systematic rules audit Carlos himself requested: pieceIsInOwnBarrier
  // used to only ever compute a corridor barrier when there was *no* track barrier at all
  // (`ownBarrierTrack === null ? ownCorridorBarrierPosition(...) : null`) - the instant a player
  // also had a barrier on the shared track, their own separate corridor barrier went completely
  // invisible to this check and silently unlocked, even though a color's own 4 pieces splitting
  // into a track pair and a separate corridor pair is a fully legitimate, reachable state.
  it('a corridor barrier stays locked even while the same player also has a track barrier elsewhere', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5
    red.pieces[1].state = 'OnTrack'
    red.pieces[1].trackPosition = 5 // track barrier at 5
    red.pieces[2].state = 'InHomeCorridor'
    red.pieces[2].corridorPosition = 1
    red.pieces[3].state = 'InHomeCorridor'
    red.pieces[3].corridorPosition = 1 // corridor barrier at index 1, at the same time

    const dice = new ScriptedDice([3, 2, 1]) // not a double
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let offered: import('../src/core/rules/moveOption').MoveOption[] = []
    manager.moveChoicesReady.on((moves) => (offered = moves))
    let notPossible = false
    let reason: string | null = null
    manager.moveNotPossible.on((r) => {
      notPossible = true
      reason = r
    })

    manager.requestRoll()

    // All 4 pieces are locked - the track barrier and the corridor barrier alike - so this roll has
    // no legal move at all, same as the already-covered single-barrier case.
    expect(notPossible).toBe(true)
    expect(reason).toBe('barrier')
    expect(offered).toEqual([])
    expect(red.pieces[2].corridorPosition).toBe(1)
    expect(red.pieces[3].corridorPosition).toBe(1)
  })

  // Reported directly, from a real play session: dieA=4 landed a red pawn exactly on an opposing
  // Parkiller sitting on a protected square, which PK4 says just coexist as a barrier rather than
  // sending the pawn home (PK5) - then the player used the *other*, non-double die (6) to move that
  // same pawn on again, and the client asked whether that should really have been allowed. It
  // should: per this describe block's own rulebook page, "OPENING A BARRIER" names only two ways to
  // free a *same-color* barrier (a double, or an opposing Parki) precisely because that one has a
  // defined release valve - a mixed pawn+Parkiller pairing has no such mechanism (the Parkiller
  // isn't the mover's own piece, and doubles don't move it at all), so treating it as a lock would
  // strand it with no way out for either side. ownBarrierTrackPosition only ever counts a player's
  // own 4 pieces (see its own doc comment) - the opposing Parkiller was never a candidate to begin
  // with, so this pawn was never "in a barrier" for this obligation's own purposes at all.
  it('a pawn sharing a protected square with an opposing Parkiller is not locked - the other die still moves it', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 6
    blue.parkiller.corridorPosition = blue.parkiller.corridorLength
    blue.parkiller.trackPosition = 10 // a safe square on this test board - PK4 applies, not PK5

    const dice = new ScriptedDice([4, 6, 1]) // not a double
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    manager.requestRoll()
    const firstMove = manager.submitMove(red.pieces[0]) // 6 -> 10, lands on blue's protected Parkiller

    // PK4: coexists, no elimination either way - the pawn is still right there, on the same square.
    expect(firstMove?.eliminatedByParkiller).toBeFalsy()
    expect(red.pieces[0].state).toBe('OnTrack')
    expect(red.pieces[0].trackPosition).toBe(10)
    expect(blue.parkiller.state).toBe('InPlay')

    // The remaining die (6, not a double) still moves this same pawn on - it was never locked.
    const secondMove = manager.submitMove(red.pieces[0]) // 10 -> 16
    expect(secondMove).not.toBeNull()
    expect(red.pieces[0].trackPosition).toBe(16)
  })
})

describe('TurnManager - landing on an unprotected opposing Parkiller (PK5)', () => {
  // Reported directly ("el azul cayó encima del parki rojo y se volvió loco...en vez de morir,
  // contó 20" - blue landed on the red Parki and went crazy, instead of dying it counted 20): the
  // applyMove/parchisRules.test.ts level already covers eliminatedByParkiller being set correctly
  // in isolation, but not whether TurnManager's own reward plumbing (submitMove's own
  // `capturedPiece || capturedParkillerColor` check) stays correctly silent for this specific
  // result, only for a real capture/Parkiller-kill. This exercises the full requestRoll/submitMove
  // path the actual game runs, not just applyMove in isolation.
  it('sends the pawn home with no reward offered, on a plain (non-double) roll', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 2
    blue.parkiller.corridorPosition = blue.parkiller.corridorLength
    blue.parkiller.trackPosition = 5 // not a safe square on this test board

    const dice = new ScriptedDice([3, 7, 1]) // not a double - PK6's Parkiller-kill window stays closed
    const manager = new TurnManager(board, [red, blue], defaultRuleSettings(), dice)

    let rewardOffered = false
    manager.rewardOffered.on(() => (rewardOffered = true))

    manager.requestRoll()
    const result = manager.submitMove(red.pieces[0]) // 2 -> 5, lands on blue's unprotected Parkiller

    expect(result?.eliminatedByParkiller).toBe(true)
    expect(result?.capturedPiece).toBeNull()
    expect(result?.capturedParkillerColor).toBeNull()
    expect(red.pieces[0].state).toBe('InYard')
    expect(blue.parkiller.state).toBe('InPlay')
    expect(rewardOffered).toBe(false)
  })
})
