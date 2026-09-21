import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardData } from '../src/core/board/boardData'
import { BotController, type BotDrivableSession } from '../src/core/gameFlow/botController'
import type { DiceRoll } from '../src/core/gameFlow/turnManager'
import { createPlayerState } from '../src/core/gameFlow/playerState'
import type { PieceColor } from '../src/core/pieceColor'
import type { Piece } from '../src/core/pieces/piece'
import type { MoveOption, MoveResult } from '../src/core/rules/moveOption'

// Minimal Listenable<T> + emit() - same shape as TurnManager's own EventEmitter, small enough to
// duplicate here rather than reach into a gameFlow-internal implementation detail.
class Emitter<T> {
  private listeners: Array<(value: T) => void> = []
  on(listener: (value: T) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }
  emit(value: T): void {
    for (const listener of [...this.listeners]) listener(value)
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

// A hand-driven stand-in for TurnManager/HostTurnManagerBridge that lets this test dictate exactly
// which single move is on offer and exactly what applying it returns - no need to fight
// getValidMoves' own filtering just to force a specific, rare combination (PK5 self-elimination
// with zero safe alternative) into existence. Mirrors the real TurnManager's own synchronous
// contract that every constructor comment in botController.ts already describes: submitMoveForBot
// resolves synchronously, and - since this move ends the roll with nothing left to spend - fires
// turnStarted for the next color before submitMoveForBot even returns, exactly like a real
// endTurn() would.
class FakeSession implements BotDrivableSession {
  currentPlayer: import('../src/core/gameFlow/playerState').PlayerState
  readonly players: readonly import('../src/core/gameFlow/playerState').PlayerState[]
  readonly board: BoardData
  readonly turnStarted = new Emitter<import('../src/core/gameFlow/playerState').PlayerState>()
  readonly diceRolled = new Emitter<DiceRoll>()
  readonly moveChoicesReady = new Emitter<MoveOption[]>()
  readonly moveApplied = new Emitter<MoveResult>()

  private nextMove: MoveOption | null = null
  private nextResult: MoveResult | null = null
  private nextTurnPlayer: import('../src/core/gameFlow/playerState').PlayerState | null = null

  constructor(
    players: readonly import('../src/core/gameFlow/playerState').PlayerState[],
    board: BoardData,
  ) {
    this.players = players
    this.board = board
    this.currentPlayer = players[0]
  }

  // Test-only setup: what the *next* rollForBot() call should offer, what submitMoveForBot()
  // should resolve to, and which player's turn starts immediately afterward (simulating a real
  // endTurn() firing synchronously once nothing is left to spend this roll).
  armRoll(move: MoveOption, result: MoveResult, nextTurnPlayer: import('../src/core/gameFlow/playerState').PlayerState) {
    this.nextMove = move
    this.nextResult = result
    this.nextTurnPlayer = nextTurnPlayer
  }

  rollForBot(): void {
    // blackDie: 0 - not a real roll value, but this is a hand-driven fake and a zero here keeps
    // this test's own busy-window math isolated to exactly the one thing it's checking (the move's
    // own walk-then-bounce time), with no separate Parkiller-hop budget mixed in.
    this.diceRolled.emit({ dieA: 1, dieB: 1, blackDie: 0 })
    if (this.nextMove) this.moveChoicesReady.emit([this.nextMove])
  }

  submitMoveForBot(_piece: Piece, _amount?: number): MoveResult | null {
    const result = this.nextResult
    if (!result) return null
    this.moveApplied.emit(result)
    if (this.nextTurnPlayer) {
      this.currentPlayer = this.nextTurnPlayer
      const player = this.nextTurnPlayer
      this.nextTurnPlayer = null
      this.turnStarted.emit(player)
    }
    return result
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BotController busy-window timing around a PK5 self-elimination', () => {
  // Reproduces, at the logic layer (no scene/Three.js needed), the exact mechanism behind a real
  // client report: a pawn that just moved and got sent home by an opposing Parkiller mid-move
  // (PK5) plays a longer animation than a plain move of the same `amount` - an extra "flung home"
  // bounce (CAPTURE_RETURN_HOPS, matching scene/piecePosition.ts's own constant of the same name)
  // on top of the ordinary amount-hop walk. Before this fix, BotController's own busyUntilMs
  // accounting only ever budgeted `amount * hopDurationMs` for this move, so the very next player's
  // roll (if that next player is also a bot, driven by this same class) could fire while that extra
  // bounce was still genuinely playing on screen - and BoardScene/PieceMesh's shared diceSettledAt
  // gate, re-armed by that new roll, would snap the still-animating piece back to its own hop's
  // starting square for the reveal's duration, then resume - reading as "the pawn that moved
  // reverts to its original position for a few seconds while the next player's dice are rolling,
  // then catches up".
  it('does not roll for the next player until the self-eliminated pawn\'s full walk-then-bounce would have finished playing', () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5

    const session = new FakeSession([red, blue], board)
    const thinkDelayMs = 10
    const hopDurationMs = 100
    const diceSpinMs = 10
    // turnChangeHoldMs=0 - this test isolates the self-elimination bounce timing (CAPTURE_RETURN_HOPS)
    // from the separate turn-handoff hold (TURN_CHANGE_HOLD_MS), which would otherwise dwarf the
    // exact window this test means to check.
    const bots = new BotController(session, new Set<PieceColor>(['Red', 'Blue']), thinkDelayMs, hopDurationMs, diceSpinMs, 0, 0)

    const amount = 2 // sum(1+1): 5 -> 7, landing exactly on an unprotected opposing Parkiller (PK5)
    const move: MoveOption = {
      piece: red.pieces[0],
      kind: 'TrackMove',
      resultingTrackPosition: 7,
      resultingCorridorPosition: -1,
      amount,
      // 'sum', not 'dieA'/'dieB' - deliberately: wouldCapture's own Parkiller-capture branch (PK6,
      // used elsewhere in this class to predict a capture-worthy celebration) only ever fires for a
      // single die's own face value (see that function's own PK6 comment), never the sum - keeping
      // this a sum move means this test's own move is unambiguously *only* a self-elimination
      // (PK5), never also read as a Parkiller capture by that unrelated heuristic, which would pull
      // in the much larger, fixed CELEBRATION_HOLD_MS on top and swamp the exact timing this test
      // means to isolate.
      diceSource: 'sum',
    }
    const result: MoveResult = {
      movedPiece: { ...red.pieces[0], state: 'InYard', trackPosition: -1, corridorPosition: -1 },
      amount,
      capturedPiece: null,
      capturedParkillerColor: null,
      pieceFinished: false,
      eliminatedByParkiller: true,
      eliminatedByParkillerAt: 7,
      eliminatedByParkillerColor: 'Blue',
    }
    // blue.parkiller sits exactly where the move lands, unprotected (7 is not in {0, 10}) - matches
    // wouldWalkIntoUnprotectedParki's own criteria, the same helper this class already uses
    // elsewhere to *avoid* this outcome when a safer move exists; here it's the only move on offer.
    blue.parkiller.corridorPosition = blue.parkiller.corridorLength
    blue.parkiller.trackPosition = 7

    let blueRolled = false
    const originalRollForBot = session.rollForBot.bind(session)
    session.rollForBot = () => {
      if (session.currentPlayer.color === 'Blue') blueRolled = true
      originalRollForBot()
    }

    session.armRoll(move, result, blue)

    session.turnStarted.emit(red) // Red's turn starts
    vi.advanceTimersByTime(thinkDelayMs) // Red's think-delay elapses -> rollForBot() -> moveChoicesReady
    // The roll's own busy window (diceSpinMs(10) + parkiRevealHoldMs(0) + blackDie(0)*hopDurationMs
    // = 10ms - FakeSession.rollForBot's own diceRolled.emit always uses blackDie: 0, see its own
    // comment) must clear before the chosen piece is even highlighted, via onMoveChoicesReady's own
    // scheduleRespectingBusy(0, ...).
    const rollBusyMs = diceSpinMs + 0 /* parkiRevealHoldMs */ + 0 /* blackDie */ * hopDurationMs
    vi.advanceTimersByTime(rollBusyMs) // the roll's own busy window clears -> the piece is highlighted
    vi.advanceTimersByTime(thinkDelayMs) // Red's own move-decision think-delay elapses -> submitMoveForBot()
    // -> moveApplied, then (this move ends Red's turn) turnStarted(blue) fires synchronously, exactly
    // like a real TurnManager's endTurn() would while the self-elimination "flung home" bounce is
    // still meant to be playing on screen.

    // Real total animation time for this move: amount(2)*hopDurationMs(100) = 200ms for the walk,
    // plus CAPTURE_RETURN_HOPS(3)*hopDurationMs(100) = 300ms for the bounce home = 500ms. Blue's own
    // onTurnStarted schedules its roll respecting whatever's left of that window (thinkDelayMs is
    // far shorter than it, so the window - not the think-delay - is what actually governs here).
    // Advancing to just short of it must NOT yet have rolled for Blue - this is the exact window a
    // premature roll used to fire inside before this fix (see this file's own top comment).
    const selfEliminationAnimationMs = amount * hopDurationMs + 3 * hopDurationMs
    vi.advanceTimersByTime(selfEliminationAnimationMs - 1)
    expect(blueRolled).toBe(false)

    // Advancing past the full, correctly-budgeted window does roll for Blue.
    vi.advanceTimersByTime(2)
    expect(blueRolled).toBe(true)

    bots.dispose()
  })
})

describe('BotController busy-window timing around a HUMAN move that ordinarily captures (no self-elimination)', () => {
  // Reproduces the *other* half of the same reported symptom, found after the PK5 self-elimination
  // fix above (and RemoteTurnManager.ts's own matching online-replay fix) had already shipped and
  // the client reported it again anyway ("Sigue volviendo atrás antes de que lance el jugador
  // siguiente" - it keeps going back before the next player rolls). session.moveApplied.on's own
  // busy-window accounting - the *only* call site covering a non-bot mover's move at all - used to
  // add CAPTURE_RETURN_HOPS' own extra bounce time solely for result.eliminatedByParkiller, leaving
  // an ORDINARY capture (result.capturedPiece set) with zero extra margin: a human capturing with a
  // small amount left the very next bot (Blue here) free to roll while the captured pawn's own
  // separate "flung home" bounce-home animation (BoardScene.tsx's own captureFlights, which only
  // starts once this move's own hop has already cleared) was still genuinely playing.
  it("does not roll for the next bot until a human's ordinary capturing move's full walk-then-bounce would have finished playing", () => {
    const board = buildTestBoard()
    const red = createPlayerState('Red', board)
    const blue = createPlayerState('Blue', board)
    red.pieces[0].state = 'OnTrack'
    red.pieces[0].trackPosition = 5
    blue.pieces[0].state = 'OnTrack'
    blue.pieces[0].trackPosition = 6

    const session = new FakeSession([red, blue], board)
    const thinkDelayMs = 10
    const hopDurationMs = 100
    const diceSpinMs = 10
    // Only Blue is bot-controlled - Red is the human mover this test is about; turnChangeHoldMs=0
    // isolates the capture-bounce timing (CAPTURE_RETURN_HOPS) from the separate, much larger,
    // fixed turn-handoff hold (TURN_CHANGE_HOLD_MS), same reasoning as the test above.
    const bots = new BotController(session, new Set<PieceColor>(['Blue']), thinkDelayMs, hopDurationMs, diceSpinMs, 0, 0)

    let blueRolled = false
    const originalRollForBot = session.rollForBot.bind(session)
    session.rollForBot = () => {
      blueRolled = true
      originalRollForBot()
    }

    // amount=1 - deliberately small: amount*hopDurationMs (100ms) alone is far short of the
    // captured pawn's own real bounce-home time (3*hopDurationMs=300ms), the exact gap a small
    // ordinary capture used to leave completely unbudgeted for a human mover.
    const amount = 1
    const result: MoveResult = {
      movedPiece: { ...red.pieces[0], trackPosition: 6 },
      amount,
      capturedPiece: blue.pieces[0],
      capturedParkillerColor: null,
      pieceFinished: false,
    }

    session.turnStarted.emit(red) // establishes Red as the last-known turn color, not a bot - no-op scheduling
    session.moveApplied.emit(result) // Red's own (human) move applies - this is the listener under test
    session.currentPlayer = blue // mirrors a real TurnManager already having moved on by the time...
    session.turnStarted.emit(blue) // ...this fires - a genuine handoff, Blue is a bot and schedules its own roll

    // Real total animation time for this move: amount(1)*hopDurationMs(100) = 100ms for the walk,
    // plus CAPTURE_RETURN_HOPS(3)*hopDurationMs(100) = 300ms for the captured pawn's own bounce
    // home = 400ms. Advancing to just short of it must NOT yet have rolled for Blue.
    const captureAnimationMs = amount * hopDurationMs + 3 * hopDurationMs
    vi.advanceTimersByTime(captureAnimationMs - 1)
    expect(blueRolled).toBe(false)

    // Advancing past the full, correctly-budgeted window does roll for Blue.
    vi.advanceTimersByTime(2)
    expect(blueRolled).toBe(true)

    bots.dispose()
  })
})
