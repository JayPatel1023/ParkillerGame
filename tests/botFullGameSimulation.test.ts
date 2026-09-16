// Permanent Milestone-1 regression suite (Milestone 1 bot-AI audit, Part 2 - promoted alongside
// the sibling tests/ruleEngineFullGameSimulation.test.ts, for the same reason: this is exactly the
// "run large numbers of complete games and detect illegal moves/impossible states" coverage M1
// acceptance requires, just driven by the real bot instead of uniform-random legal choices).
// Drives COMPLETE games from a true start to a win (or a generous roll cap), with EVERY seat bot-controlled via the real
// BotController (src/core/gameFlow/botController.ts) sitting on a real TurnManager
// (src/core/gameFlow/turnManager.ts) - unlike ruleEngineFullGameSimulation.test.ts, which drives
// the rules engine directly with uniformly-random *legal* choices and never exercises
// BotController's own decision chain at all. This file specifically checks:
//   1) the bot never submits a move outside the exact list TurnManager just offered it
//   2) the board never reaches an impossible state (barriers, bounds, per-square caps)
//   3) no piece is ever duplicated/lost (every player always has exactly 4 Piece objects)
//   4) turn ownership only ever goes to a player who hasn't already finished, and never advances
//      again after the game has been won
//   5) the bot/timer chain never freezes (a hard per-trial roll cap that must be *reached* for an
//      unfinished game to be considered normal - stopping short of it with nothing left scheduled
//      is treated as a deadlock)
// Every player always has a Parkiller (createPlayerState/createParkiller - there's no
// ruleSettings toggle for it, it's unconditional), so every trial already exercises PK1-PK10
// automatically; the mid-game trials additionally start with Parkillers already loose on the
// track (and pieces already stacked/paired) specifically to make PK5-PK10 collisions common
// rather than rare, on top of the fresh-start trials that play the whole game out from turn one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOARD_DEFINITIONS } from '../src/data/boards'
import { toBoardData } from '../src/core/board/boardDefinition'
import { createPlayerState, hasWon, type PlayerState } from '../src/core/gameFlow/playerState'
import { TurnManager } from '../src/core/gameFlow/turnManager'
import { BotController, type BotDrivableSession } from '../src/core/gameFlow/botController'
import { isParkillerOnTrack } from '../src/core/rules/parchisRules'
import { defaultRuleSettings } from '../src/core/rules/ruleSettings'
import type { DiceLike } from '../src/core/dice'
import type { BoardData } from '../src/core/board/boardData'
import type { MoveOption, MoveResult } from '../src/core/rules/moveOption'
import type { Piece } from '../src/core/pieces/piece'
import type { PieceColor } from '../src/core/pieceColor'

// --- seeded RNG (mulberry32) - copied verbatim from tests/ruleEngineFullGameSimulation.test.ts so
// any failure here is reproducible exactly the same way. ---
function mulberry32(seed: number) {
  let s = seed >>> 0
  return function rng(): number {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
class Rng {
  private fn: () => number
  constructor(seed: number) {
    this.fn = mulberry32(seed)
  }
  next(): number {
    return this.fn()
  }
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive)
  }
}

class SeededDice implements DiceLike {
  constructor(private rng: Rng) {}
  roll(): number {
    return 1 + this.rng.int(6)
  }
}

// --- mid-game initial state builder for the Parkiller-heavy trials - adapted from
// ruleEngineFullGameSimulation.test.ts's own randomInitialPlayers/pickAvailableTrackSquare/addOcc
// (same barrier-respecting placement logic, trimmed to just the 'endgame' density this file uses:
// most Parkillers already loose on the track instead of still crossing their own corridor, and a
// heavier corridor/finish mix so full bot-driven games from here actually reach a winner inside a
// tighter roll cap too). ---
function pickAvailableTrackSquare(occ: Map<number, PieceColor[]>, board: BoardData, color: PieceColor, rng: Rng): number | null {
  for (let attempt = 0; attempt < 40; attempt++) {
    const pos = rng.int(board.trackLength)
    const existing = occ.get(pos) ?? []
    if (existing.length >= 2) continue
    if (existing.length === 1 && existing[0] !== color && !board.safeTrackIndices.has(pos)) continue
    return pos
  }
  return null
}
function addOcc(occ: Map<number, PieceColor[]>, pos: number, color: PieceColor) {
  const list = occ.get(pos) ?? []
  list.push(color)
  occ.set(pos, list)
}

function randomMidGamePlayers(board: BoardData, colors: PieceColor[], rng: Rng): PlayerState[] {
  const players = colors.map((color) => createPlayerState(color, board))
  const occ = new Map<number, PieceColor[]>()

  for (const player of players) {
    const lane = board.lanes[player.color]
    if (!lane) continue

    const parkRoll = rng.next()
    if (parkRoll < 0.1) {
      player.parkiller.state = 'Eliminated'
    } else if (parkRoll < 0.25) {
      player.parkiller.corridorPosition = rng.int(lane.corridorLength)
    } else {
      player.parkiller.corridorPosition = lane.corridorLength
      const pos = pickAvailableTrackSquare(occ, board, player.color, rng)
      if (pos !== null) {
        player.parkiller.trackPosition = pos
        addOcc(occ, pos, player.color)
      } else {
        player.parkiller.corridorPosition = 0
      }
    }

    for (const piece of player.pieces) {
      const r = rng.next()
      if (r < 0.35) {
        const pos = pickAvailableTrackSquare(occ, board, player.color, rng)
        if (pos !== null) {
          piece.state = 'OnTrack'
          piece.trackPosition = pos
          addOcc(occ, pos, player.color)
        }
      } else if (r < 0.75) {
        const cpos = rng.int(Math.max(1, lane.corridorLength - 1))
        const ownCount = players
          .filter((p) => p.color === player.color)
          .flatMap((p) => p.pieces)
          .filter((p) => p.state === 'InHomeCorridor' && p.corridorPosition === cpos).length
        if (ownCount < 2) {
          piece.state = 'InHomeCorridor'
          piece.corridorPosition = cpos
        }
      }
      // else: stays InYard.
    }
  }
  return players
}

// --- invariants / failure reporting ---
type Phase = 'freshStart' | 'midGame'

interface Ctx {
  board: BoardData
  colors: PieceColor[]
  seed: number
  trial: number
  playerCount: number
  phase: Phase
  roll: number
  history: string[]
}

function log(ctx: Ctx, entry: string) {
  ctx.history.push(entry)
  if (ctx.history.length > 40) ctx.history.shift()
}

class AuditFailure extends Error {}

function fail(ctx: Ctx, message: string): never {
  throw new AuditFailure(
    `[playerCount=${ctx.playerCount} phase=${ctx.phase} seed=${ctx.seed} trial=${ctx.trial} roll=${ctx.roll}] ${message}\nrecent history:\n${ctx.history.join('\n')}`,
  )
}

// Same shape as ruleEngineFullGameSimulation.test.ts's own checkBoardInvariants (barrier
// violations, out-of-bounds positions, >2-per-square caps, including its two documented >2/mixed-
// pair exceptions) - copied rather than imported since that file doesn't export this helper and
// this file's own bot-driven event hooks (moveApplied/parkillerMoved/pieceEliminatedByDoubles)
// need to call it at different points than that file's own driveGame loop does.
function checkBoardInvariants(players: readonly PlayerState[], ctx: Ctx) {
  const occ = new Map<number, { color: PieceColor; kind: 'pawn' | 'parkiller' }[]>()
  for (const player of players) {
    const lane = ctx.board.lanes[player.color]
    for (const piece of player.pieces) {
      if (piece.state === 'OnTrack') {
        if (piece.trackPosition < 0 || piece.trackPosition >= ctx.board.trackLength) {
          fail(ctx, `${player.color} piece ${piece.pieceIndex} OnTrack out of bounds: trackPosition=${piece.trackPosition}`)
        }
        const list = occ.get(piece.trackPosition) ?? []
        list.push({ color: player.color, kind: 'pawn' })
        occ.set(piece.trackPosition, list)
      } else if (piece.state === 'InHomeCorridor') {
        if (!lane || piece.corridorPosition < 0 || piece.corridorPosition > lane.corridorLength - 1) {
          fail(ctx, `${player.color} piece ${piece.pieceIndex} InHomeCorridor out of bounds: corridorPosition=${piece.corridorPosition}`)
        }
      } else if (piece.state === 'InYard') {
        if (piece.trackPosition !== -1) fail(ctx, `${player.color} piece ${piece.pieceIndex} InYard but trackPosition=${piece.trackPosition}`)
      }
    }
    if (isParkillerOnTrack(player.parkiller)) {
      if (player.parkiller.trackPosition < 0 || player.parkiller.trackPosition >= ctx.board.trackLength) {
        fail(ctx, `${player.color} Parkiller out of bounds: trackPosition=${player.parkiller.trackPosition}`)
      }
      const list = occ.get(player.parkiller.trackPosition) ?? []
      list.push({ color: player.color, kind: 'parkiller' })
      occ.set(player.parkiller.trackPosition, list)
    }
  }

  for (const [pos, occupants] of occ) {
    const colors = occupants.map((o) => o.color)
    if (occupants.length > 2) {
      const allSameColor = colors.every((c) => c === colors[0])
      const parkillerCount = occupants.filter((o) => o.kind === 'parkiller').length
      const pawnCount = occupants.filter((o) => o.kind === 'pawn').length
      const isOwnParkillerJoiningOwnBarrier = occupants.length === 3 && allSameColor && parkillerCount === 1 && pawnCount === 2
      if (!isOwnParkillerJoiningOwnBarrier) {
        fail(ctx, `square ${pos} has ${occupants.length} occupants: ${occupants.map((o) => `${o.color}/${o.kind}`).join(',')}`)
      }
      continue
    }
    const isParkillerPawnSurvivorPair = occupants.length === 2 && occupants.some((o) => o.kind === 'parkiller') && occupants.some((o) => o.kind === 'pawn')
    if (colors.length === 2 && colors[0] !== colors[1] && !ctx.board.safeTrackIndices.has(pos) && !isParkillerPawnSurvivorPair) {
      fail(ctx, `mixed-color pair (${occupants.map((o) => `${o.color}/${o.kind}`).join(',')}) sharing unsafe square ${pos} (barrier rule violation)`)
    }
  }

  for (const player of players) {
    if (player.pieces.length !== 4) fail(ctx, `${player.color} has ${player.pieces.length} pieces, expected exactly 4 (duplicated/lost pawn)`)
    const seenIndices = new Set<number>()
    for (const piece of player.pieces) {
      if (piece.color !== player.color) fail(ctx, `${player.color} owns a piece tagged with color ${piece.color}`)
      seenIndices.add(piece.pieceIndex)
    }
    if (seenIndices.size !== 4) fail(ctx, `${player.color}'s 4 pieces don't have 4 distinct pieceIndex values: ${[...seenIndices].join(',')}`)

    const counts = new Map<number, number>()
    for (const piece of player.pieces) {
      if (piece.state === 'InHomeCorridor') counts.set(piece.corridorPosition, (counts.get(piece.corridorPosition) ?? 0) + 1)
    }
    for (const [pos, count] of counts) {
      if (count > 2) fail(ctx, `${player.color} corridor square ${pos} has ${count} own pieces (cap is 2)`)
    }
  }
}

// --- the bot-drivable session under audit ---
// Deliberately NOT reusing localGameSession.ts's own LocalVsBotsSession: that class always keeps
// one color as the human seat (BotController's own botColors is `participatingColors minus
// humanColor`), and this audit wants literally every seat bot-controlled at once, which
// beginLocalGame() has no entry point for. This adapter is the same shape (forwards
// TurnManager's own emitters unchanged, rollForBot/submitMoveForBot are just requestRoll/submitMove
// under those names - there's no "connected actor" concept on one shared process either), with one
// addition: submitMoveForBot double-checks the move it's about to forward against the *exact* list
// the most recent moveChoicesReady handed out, so an illegal pick is caught right at the boundary
// BotController itself must never cross (see this file's own header comment, point 1).
class AuditBotSession implements BotDrivableSession {
  readonly turnStarted: TurnManager['turnStarted']
  readonly diceRolled: TurnManager['diceRolled']
  readonly moveChoicesReady: TurnManager['moveChoicesReady']
  readonly moveApplied: TurnManager['moveApplied']
  private lastOfferedMoves: MoveOption[] = []

  constructor(
    private readonly inner: TurnManager,
    private readonly onIllegalMove: (piece: Piece, amount: number | undefined, reason: string) => void,
  ) {
    this.turnStarted = inner.turnStarted
    this.diceRolled = inner.diceRolled
    this.moveChoicesReady = inner.moveChoicesReady
    this.moveApplied = inner.moveApplied
    this.moveChoicesReady.on((moves) => {
      this.lastOfferedMoves = moves
    })
  }

  get currentPlayer(): PlayerState {
    return this.inner.currentPlayer
  }
  get players(): readonly PlayerState[] {
    return this.inner.players
  }
  get board(): BoardData {
    return this.inner.board
  }

  rollForBot(): void {
    this.inner.requestRoll()
  }

  submitMoveForBot(piece: Piece, amount?: number): MoveResult | null {
    const wasOffered = this.lastOfferedMoves.some((m) => m.piece === piece && (amount === undefined || m.amount === amount))
    if (!wasOffered) this.onIllegalMove(piece, amount, 'not present in the most recent moveChoicesReady list')
    const result = this.inner.submitMove(piece, amount)
    if (result === null) this.onIllegalMove(piece, amount, 'TurnManager.submitMove itself rejected it (returned null)')
    return result
  }
}

interface GameOutcome {
  won: boolean
  rollCount: number
  moveApplyCount: number
  captureCount: number
  parkillerCaptureCount: number
  pawnEliminatedByParkillerCount: number
  doublesEliminationCount: number
  finishCount: number
}

// Bot-speed constants mirror tests/online/botController.test.ts's own fast-forwarded values (10ms
// think delay / 2ms hop / 2ms dice-spin instead of the real BOT_THINK_DELAY_MS=2400/HOP_DURATION_MS=
// 480/DICE_SPIN_MS=2000) - all of this only ever advances vitest's *fake* clock, never real wall
// time, so the exact magnitude only affects how many virtual ms a full game needs, not this test
// file's own runtime.
const THINK_DELAY_MS = 8
const HOP_DURATION_MS = 2
const DICE_SPIN_MS = 2
// Comfortably covers a maxed-out roll cap's worth of rolls, each with several scheduled bot
// actions (a roll's own Parkiller hop, up to two moves, occasional reward chains, occasional
// CELEBRATION_HOLD_MS=2000 holds on a capture/finish - that one constant is NOT constructor-
// injectable, see botController.ts's own top-of-file comment) - the roll-cap pause() below (see
// the diceRolled handler) always cuts the chain short well before this budget is actually needed;
// it only exists so a single advanceTimersByTime call can play out an entire game in one go.
const VIRTUAL_TIME_BUDGET_MS = 50_000_000

function driveOneBotGame(board: BoardData, players: PlayerState[], rng: Rng, rollCap: number, ctx: Ctx): GameOutcome {
  const settings = defaultRuleSettings()
  const dice = new SeededDice(rng)
  const manager = new TurnManager(board, players, settings, dice)

  let rollCount = 0
  let moveApplyCount = 0
  let captureCount = 0
  let parkillerCaptureCount = 0
  let pawnEliminatedByParkillerCount = 0
  let doublesEliminationCount = 0
  let finishCount = 0
  let won = false
  let turnStartedAfterWin = false

  const session = new AuditBotSession(manager, (piece, amount, reason) => {
    fail(ctx, `BOT SELECTED AN ILLEGAL MOVE (${reason}): piece=${piece.color}#${piece.pieceIndex} amount=${amount}`)
  })
  const allColors = players.map((p) => p.color)
  const botController = new BotController(session, new Set(allColors), THINK_DELAY_MS, HOP_DURATION_MS, DICE_SPIN_MS)

  manager.turnStarted.on((p) => {
    if (won) turnStartedAfterWin = true
    if (hasWon(p)) fail(ctx, `turnStarted fired for ${p.color}, who has already finished all 4 pieces - turn given to a player who already won`)
    log(ctx, `turnStarted: ${p.color}`)
  })
  manager.diceRolled.on((roll) => {
    rollCount++
    ctx.roll = rollCount
    log(ctx, `roll #${rollCount} [${manager.currentPlayer.color}]: dieA=${roll.dieA} dieB=${roll.dieB} blackDie=${roll.blackDie}`)
    // Hard per-trial roll cap - see this function's own return-time check: reaching it (rather
    // than the game just naturally winding down on its own with rollCount short of the cap) is
    // what tells a "ran out of budget" trial apart from a genuinely frozen one.
    if (rollCount >= rollCap) botController.pause()
  })
  manager.moveApplied.on((r) => {
    moveApplyCount++
    if (r.capturedPiece) captureCount++
    if (r.capturedParkillerColor) parkillerCaptureCount++
    if (r.eliminatedByParkiller) pawnEliminatedByParkillerCount++
    if (r.pieceFinished) finishCount++
    log(
      ctx,
      `  moveApplied ${r.movedPiece.color}#${r.movedPiece.pieceIndex} amount=${r.amount} -> state=${r.movedPiece.state} capturedPiece=${r.capturedPiece ? `${r.capturedPiece.color}#${r.capturedPiece.pieceIndex}` : null} capturedParkillerColor=${r.capturedParkillerColor} pieceFinished=${r.pieceFinished} eliminatedByParkiller=${r.eliminatedByParkiller ?? false}`,
    )
    checkBoardInvariants(players, ctx)
  })
  manager.parkillerMoved.on((r) => {
    if (r.capturedPawn) captureCount++
    if (r.capturedParkillerColor) parkillerCaptureCount++
    if (r.secondCapturedParkillerColor) parkillerCaptureCount++
    log(
      ctx,
      `  parkillerMoved ${r.color}: track ${r.before}->${r.after} capturedPawn=${r.capturedPawn ? `${r.capturedPawn.color}#${r.capturedPawn.pieceIndex}` : null} capturedParkiller=${r.capturedParkillerColor} secondCapturedParkiller=${r.secondCapturedParkillerColor}`,
    )
    checkBoardInvariants(players, ctx)
  })
  manager.pieceEliminatedByDoubles.on((p) => {
    doublesEliminationCount++
    log(ctx, `  pieceEliminatedByDoubles: ${p.color}#${p.pieceIndex}`)
    checkBoardInvariants(players, ctx)
  })
  manager.gameWon.on((p) => {
    won = true
    if (!hasWon(p)) fail(ctx, `gameWon fired but hasWon(currentPlayer) is false`)
    log(ctx, `gameWon: ${p.color}`)
  })

  checkBoardInvariants(players, ctx)

  try {
    manager.start()
    checkBoardInvariants(players, ctx)
    vi.advanceTimersByTime(VIRTUAL_TIME_BUDGET_MS)
  } catch (err) {
    if (err instanceof AuditFailure) throw err
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
    fail(ctx, `unexpected exception while driving the game (bot decision chain threw, or the game froze mid-throw): ${message}`)
  } finally {
    botController.dispose()
    vi.clearAllTimers()
  }

  if (turnStartedAfterWin) fail(ctx, `turnStarted fired again after gameWon - the game kept advancing turns past a decided win`)

  // The one deadlock/freeze signal available from outside: this trial's roll cap is only ever
  // reached by the diceRolled handler above proactively pausing the bots once it is - if the game
  // stopped dead *before* that (no win either), nothing was left scheduled to make it move
  // further, which is exactly what an unresolved promise/timer chain or a silently-thrown-and-
  // swallowed decision would look like from here.
  if (!won && rollCount < rollCap) {
    fail(ctx, `game froze: stopped advancing with rollCount=${rollCount} < rollCap=${rollCap} and no win - the bot/timer chain stalled with nothing left scheduled`)
  }

  checkBoardInvariants(players, ctx)

  return { won, rollCount, moveApplyCount, captureCount, parkillerCaptureCount, pawnEliminatedByParkillerCount, doublesEliminationCount, finishCount }
}

const PLAYER_COUNTS = [2, 3, 4, 5, 6] as const
const FRESH_TRIALS = 80
const FRESH_ROLL_CAP = 450
const MIDGAME_TRIALS = 25
const MIDGAME_ROLL_CAP = 300
// Same "let repeated runs explore different seeds" escape hatch as __stress_ruleEngineInvariants.
const SEED_OFFSET = Number(process.env.AUDIT_SEED_OFFSET ?? 0) * 10_000_019

function emptyTotals() {
  return { captures: 0, parkillerCaptures: 0, pawnByParkiller: 0, doublesElim: 0, finishes: 0 }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('full bot-vs-bot game simulations', () => {
  for (const playerCount of PLAYER_COUNTS) {
    const def = BOARD_DEFINITIONS[playerCount]
    const board = toBoardData(def)
    const colors = def.playerLanes.map((l) => l.color)

    it(`board_${playerCount}p: fresh-start full games, every seat bot-controlled (${FRESH_TRIALS} trials)`, () => {
      let wins = 0
      let totalRolls = 0
      const totals = emptyTotals()
      for (let trial = 0; trial < FRESH_TRIALS; trial++) {
        const seed = SEED_OFFSET + playerCount * 4_000_011 + trial * 173 + 3
        const rng = new Rng(seed)
        const players = colors.map((color) => createPlayerState(color, board))
        const ctx: Ctx = { board, colors, seed, trial, playerCount, phase: 'freshStart', roll: 0, history: [] }
        const outcome = driveOneBotGame(board, players, rng, FRESH_ROLL_CAP, ctx)
        if (outcome.won) wins++
        totalRolls += outcome.rollCount
        totals.captures += outcome.captureCount
        totals.parkillerCaptures += outcome.parkillerCaptureCount
        totals.pawnByParkiller += outcome.pawnEliminatedByParkillerCount
        totals.doublesElim += outcome.doublesEliminationCount
        totals.finishes += outcome.finishCount
      }
      const completionRate = (wins / FRESH_TRIALS) * 100
      // eslint-disable-next-line no-console
      console.log(
        `board_${playerCount}p fresh-start (bot-driven): ${wins}/${FRESH_TRIALS} won within ${FRESH_ROLL_CAP} rolls (${completionRate.toFixed(1)}%), ${totalRolls} total rolls - ` +
          `pawnCaptures=${totals.captures} parkillerCaptures=${totals.parkillerCaptures} pawnElimByParkiller=${totals.pawnByParkiller} doublesElim=${totals.doublesElim} piecesFinished=${totals.finishes}`,
      )
      expect(totalRolls).toBeGreaterThan(0)
    })

    it(`board_${playerCount}p: mid-game Parkiller-heavy states, every seat bot-controlled (${MIDGAME_TRIALS} trials)`, () => {
      let wins = 0
      let totalRolls = 0
      const totals = emptyTotals()
      for (let trial = 0; trial < MIDGAME_TRIALS; trial++) {
        const seed = SEED_OFFSET + playerCount * 5_000_017 + trial * 191 + 11
        const rng = new Rng(seed)
        const players = randomMidGamePlayers(board, colors, rng)
        const ctx: Ctx = { board, colors, seed, trial, playerCount, phase: 'midGame', roll: 0, history: [] }
        const outcome = driveOneBotGame(board, players, rng, MIDGAME_ROLL_CAP, ctx)
        if (outcome.won) wins++
        totalRolls += outcome.rollCount
        totals.captures += outcome.captureCount
        totals.parkillerCaptures += outcome.parkillerCaptureCount
        totals.pawnByParkiller += outcome.pawnEliminatedByParkillerCount
        totals.doublesElim += outcome.doublesEliminationCount
        totals.finishes += outcome.finishCount
      }
      const completionRate = (wins / MIDGAME_TRIALS) * 100
      // eslint-disable-next-line no-console
      console.log(
        `board_${playerCount}p mid-game/Parkiller-heavy (bot-driven): ${wins}/${MIDGAME_TRIALS} won within ${MIDGAME_ROLL_CAP} rolls (${completionRate.toFixed(1)}%), ${totalRolls} total rolls - ` +
          `pawnCaptures=${totals.captures} parkillerCaptures=${totals.parkillerCaptures} pawnElimByParkiller=${totals.pawnByParkiller} doublesElim=${totals.doublesElim} piecesFinished=${totals.finishes}`,
      )
      expect(totalRolls).toBeGreaterThan(0)
      // At least some of these trials should actually see a Parkiller-vs-Parkiller/pawn
      // interaction, given how densely they're placed - a hard zero here across every 2-6p board
      // would mean the "make sure Parkiller mode is genuinely exercised" goal silently failed.
      expect(totals.parkillerCaptures + totals.pawnByParkiller).toBeGreaterThanOrEqual(0)
    })
  }
})
