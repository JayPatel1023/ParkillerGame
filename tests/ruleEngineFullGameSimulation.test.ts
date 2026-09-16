// Permanent Milestone-1 regression suite (promoted from an earlier throwaway stress test written
// to verify a specific bug report - kept and renamed since it's exactly the "run large numbers of
// complete games and detect illegal moves/impossible states" coverage M1 acceptance requires).
//
// Property-based stress test of the rules engine (TurnManager + parchisRules) across all 5 real
// board sizes (src/data/boards.ts / generated-boards.json), driving thousands of random-but-legal
// move sequences and checking invariants that must never be violated. Any failure prints the exact
// seed/board/trial so it can be reproduced and minimized.
import { describe, expect, it } from 'vitest'
import { BOARD_DEFINITIONS } from '../src/data/boards'
import { toBoardData } from '../src/core/board/boardDefinition'
import { createPlayerState, hasWon, type PlayerState } from '../src/core/gameFlow/playerState'
import { TurnManager } from '../src/core/gameFlow/turnManager'
import { isParkillerOnTrack } from '../src/core/rules/parchisRules'
import { defaultRuleSettings } from '../src/core/rules/ruleSettings'
import type { DiceLike } from '../src/core/dice'
import type { BoardData } from '../src/core/board/boardData'
import type { MoveOption } from '../src/core/rules/moveOption'
import type { PieceColor } from '../src/core/pieceColor'

// --- seeded RNG (mulberry32) so any failure is exactly reproducible from its seed ---
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
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]
  }
  bool(pTrue = 0.5): boolean {
    return this.next() < pTrue
  }
}

class SeededDice implements DiceLike {
  constructor(private rng: Rng) {}
  roll(): number {
    return 1 + this.rng.int(6)
  }
}

// --- random initial state construction, respecting the barrier invariant from the start ---
// (own-color pairs anywhere, mixed pairs only on safe squares, never >2 on one square) so the
// invariant checker below only ever needs to confirm the engine *preserves* this, not that our
// own fixture generator already broke it.
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

type Density = 'sparse' | 'general' | 'endgame'

function randomInitialPlayers(board: BoardData, colors: PieceColor[], rng: Rng, density: Density): PlayerState[] {
  const players = colors.map((color) => createPlayerState(color, board))
  const occ = new Map<number, PieceColor[]>()

  const trackWeight = density === 'sparse' ? 0.3 : density === 'general' ? 0.45 : 0.35
  const corridorWeight = density === 'endgame' ? 0.4 : density === 'general' ? 0.15 : 0.05

  for (const player of players) {
    const lane = board.lanes[player.color]
    if (!lane) continue

    // Parkiller: crossing its own corridor, fully on the track, or eliminated.
    const parkRoll = rng.next()
    if (parkRoll < 0.15) {
      player.parkiller.state = 'Eliminated'
    } else if (parkRoll < 0.35) {
      player.parkiller.corridorPosition = rng.int(lane.corridorLength) // still crossing, 0..corridorLength-1
    } else {
      player.parkiller.corridorPosition = lane.corridorLength
      const pos = pickAvailableTrackSquare(occ, board, player.color, rng)
      if (pos !== null) {
        player.parkiller.trackPosition = pos
        addOcc(occ, pos, player.color)
      } else {
        player.parkiller.corridorPosition = 0 // couldn't place - leave it safely crossing instead
      }
    }

    for (const piece of player.pieces) {
      const r = rng.next()
      if (r < trackWeight) {
        const pos = pickAvailableTrackSquare(occ, board, player.color, rng)
        if (pos !== null) {
          piece.state = 'OnTrack'
          piece.trackPosition = pos
          addOcc(occ, pos, player.color)
        }
      } else if (r < trackWeight + corridorWeight) {
        const cpos = rng.int(Math.max(1, lane.corridorLength - 1)) // exclude the final (Finished) slot
        const ownCount = players
          .filter((p) => p.color === player.color)
          .flatMap((p) => p.pieces)
          .filter((p) => p.state === 'InHomeCorridor' && p.corridorPosition === cpos).length
        if (ownCount < 2) {
          piece.state = 'InHomeCorridor'
          piece.corridorPosition = cpos
        }
      }
      // else: stays InYard (the createPlayerState default)
    }
  }
  return players
}

// --- invariants ---
interface Ctx {
  board: BoardData
  colors: PieceColor[]
  seed: number
  trial: number
  playerCount: number
  density: Density
  roll: number
  history: string[]
}

function log(ctx: Ctx, entry: string) {
  ctx.history.push(entry)
  if (ctx.history.length > 40) ctx.history.shift()
}

function fail(ctx: Ctx, message: string): never {
  throw new Error(
    `[playerCount=${ctx.playerCount} density=${ctx.density} seed=${ctx.seed} trial=${ctx.trial} roll=${ctx.roll}] ${message}\nrecent history:\n${ctx.history.join('\n')}`,
  )
}

type Occupant = { color: PieceColor; kind: 'pawn' | 'parkiller' }

function checkBoardInvariants(players: readonly PlayerState[], ctx: Ctx) {
  const occ = new Map<number, Occupant[]>()
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
    // Parkiller still crossing its own corridor must stay in range too.
    if (player.parkiller.state === 'InPlay' && player.parkiller.corridorPosition < player.parkiller.corridorLength) {
      if (player.parkiller.corridorPosition < 0) fail(ctx, `${player.color} Parkiller negative corridorPosition`)
    }
  }

  for (const [pos, occupants] of occ) {
    const colors = occupants.map((o) => o.color)
    if (occupants.length > 2) {
      // Documented, deliberate exception (see resolveParkillerCollisions' own comment on
      // "ownBarrier"): a player's own Parkiller landing on that same player's own existing 2-pawn
      // barrier joins it harmlessly (no elimination) - exactly 3 occupants, all the same color,
      // with a Parkiller among them, is the *only* >2 shape this engine can legitimately produce.
      const allSameColor = colors.every((c) => c === colors[0])
      const parkillerCount = occupants.filter((o) => o.kind === 'parkiller').length
      const pawnCount = occupants.filter((o) => o.kind === 'pawn').length
      const isOwnParkillerJoiningOwnBarrier = occupants.length === 3 && allSameColor && parkillerCount === 1 && pawnCount === 2
      if (!isOwnParkillerJoiningOwnBarrier) {
        fail(ctx, `square ${pos} has ${occupants.length} occupants: ${occupants.map((o) => `${o.color}/${o.kind}`).join(',')}`)
      }
      continue
    }
    // Confirmed against the reference GameMaker implementation (obj_posicion_ficha's own
    // ingresaFicha): a Parkiller landing on a pre-existing 2-pawn barrier of a color other than
    // its own (legal anywhere - an own-color barrier isn't restricted to safe squares) eliminates
    // exactly one of the two (PK5/PK10, "unconditional on the square's own protected flag") and
    // leaves the survivor coexisting with the arriving Parkiller - with no further safe-square
    // check applied to that resulting pair. The reference source does the exact same thing (one
    // ficha eliminated via `candidata`, the other stays, `agregarFicha` never re-checks the
    // square's own protection for the remainder) - not a divergence to fix here, just a pairing
    // shape this invariant needs to allow: exactly one pawn + one Parkiller of different colors.
    const isParkillerPawnSurvivorPair = occupants.length === 2 && occupants.some((o) => o.kind === 'parkiller') && occupants.some((o) => o.kind === 'pawn')
    if (colors.length === 2 && colors[0] !== colors[1] && !ctx.board.safeTrackIndices.has(pos) && !isParkillerPawnSurvivorPair) {
      fail(ctx, `mixed-color pair (${occupants.map((o) => `${o.color}/${o.kind}`).join(',')}) sharing unsafe square ${pos} (barrier rule violation)`)
    }
  }

  for (const player of players) {
    const lane = ctx.board.lanes[player.color]
    if (!lane) continue
    const counts = new Map<number, number>()
    for (const piece of player.pieces) {
      if (piece.state === 'InHomeCorridor') counts.set(piece.corridorPosition, (counts.get(piece.corridorPosition) ?? 0) + 1)
    }
    for (const [pos, count] of counts) {
      if (count > 2) fail(ctx, `${player.color} corridor square ${pos} has ${count} own pieces (cap is 2)`)
    }
  }
}

// --- driving the engine ---
function driveGame(board: BoardData, players: PlayerState[], rng: Rng, maxRolls: number, ctx: Ctx) {
  const settings = defaultRuleSettings()
  const dice = new SeededDice(rng)
  const manager = new TurnManager(board, players, settings, dice)

  let pendingMoves: MoveOption[] | null = null
  let won = false
  let turnStartedCount = 0
  let moveNotPossibleFiredThisRoll = false

  manager.moveChoicesReady.on((moves) => {
    pendingMoves = moves
  })
  manager.moveNotPossible.on((reason) => {
    moveNotPossibleFiredThisRoll = true
    log(ctx, `  moveNotPossible: ${reason}`)
  })
  manager.gameWon.on(() => {
    won = true
  })
  manager.turnStarted.on((p) => {
    turnStartedCount++
    log(ctx, `  turnStarted: ${p.color}`)
  })
  manager.diceRolled.on((roll) => {
    log(ctx, `roll #${ctx.roll} [${manager.currentPlayer.color}]: dieA=${roll.dieA} dieB=${roll.dieB} blackDie=${roll.blackDie}`)
  })
  manager.parkillerMoved.on((r) => {
    log(
      ctx,
      `  parkillerMoved ${r.color}: track ${r.before}->${r.after} corridor ${r.beforeCorridorPosition}->${r.afterCorridorPosition} capturedPawn=${r.capturedPawn ? `${r.capturedPawn.color}#${r.capturedPawn.pieceIndex}` : null} capturedParkiller=${r.capturedParkillerColor} secondCapturedParkiller=${r.secondCapturedParkillerColor}`,
    )
  })
  manager.moveApplied.on((r) => {
    log(
      ctx,
      `  moveApplied ${r.movedPiece.color}#${r.movedPiece.pieceIndex} amount=${r.amount} -> state=${r.movedPiece.state} track=${r.movedPiece.trackPosition} corridor=${r.movedPiece.corridorPosition} capturedPiece=${r.capturedPiece ? `${r.capturedPiece.color}#${r.capturedPiece.pieceIndex}` : null} capturedParkillerColor=${r.capturedParkillerColor} pieceFinished=${r.pieceFinished} eliminatedByParkiller=${r.eliminatedByParkiller ?? false}`,
    )
  })
  manager.rewardOffered.on((g) => log(ctx, `  rewardOffered: ${g.amount} (${g.reason})`))
  manager.rewardForfeited.on((g) => log(ctx, `  rewardForfeited: ${g.amount} (${g.reason})`))
  manager.pieceEliminatedByDoubles.on((p) => log(ctx, `  pieceEliminatedByDoubles: ${p.color}#${p.pieceIndex}`))
  // arrivedAt monotonicity per piece/parkiller
  const lastArrivedAt = new Map<string, number>()
  const checkArrivedAt = () => {
    for (const p of players) {
      for (const piece of p.pieces) {
        const key = `${p.color}:${piece.pieceIndex}`
        const prev = lastArrivedAt.get(key) ?? 0
        if (piece.arrivedAt < prev) fail(ctx, `${key} arrivedAt went backwards: ${prev} -> ${piece.arrivedAt}`)
        lastArrivedAt.set(key, piece.arrivedAt)
      }
      const key = `${p.color}:parkiller`
      const prev = lastArrivedAt.get(key) ?? 0
      if (p.parkiller.arrivedAt < prev) fail(ctx, `${key} arrivedAt went backwards: ${prev} -> ${p.parkiller.arrivedAt}`)
      lastArrivedAt.set(key, p.parkiller.arrivedAt)
    }
  }
  // Finished pieces must never move again.
  const finishedSnapshot = new Map<string, { trackPosition: number; corridorPosition: number }>()
  const checkFinishedNeverMoves = () => {
    for (const p of players) {
      for (const piece of p.pieces) {
        const key = `${p.color}:${piece.pieceIndex}`
        if (piece.state === 'Finished') {
          const prior = finishedSnapshot.get(key)
          if (prior) {
            if (prior.trackPosition !== piece.trackPosition || prior.corridorPosition !== piece.corridorPosition) {
              fail(ctx, `${key} Finished piece moved: was ${JSON.stringify(prior)}, now trackPosition=${piece.trackPosition} corridorPosition=${piece.corridorPosition}`)
            }
          } else {
            finishedSnapshot.set(key, { trackPosition: piece.trackPosition, corridorPosition: piece.corridorPosition })
          }
        }
      }
    }
  }

  manager.start()
  checkBoardInvariants(players, ctx)
  checkArrivedAt()

  let totalSubmits = 0
  for (let roll = 0; roll < maxRolls && !won; roll++) {
    ctx.roll = roll
    pendingMoves = null
    moveNotPossibleFiredThisRoll = false
    const turnStartedBefore = turnStartedCount

    manager.requestRoll()
    checkBoardInvariants(players, ctx)
    checkArrivedAt()
    checkFinishedNeverMoves()

    let safety = 0
    for (;;) {
      if (won) break
      const options = (pendingMoves ?? []) as MoveOption[]
      if (options.length === 0) break
      safety++
      totalSubmits++
      if (safety > 30) fail(ctx, `runaway reward/move chain within a single roll (>30 submitMove calls) - reward queue likely stuck`)

      const choice: MoveOption = rng.pick(options)
      pendingMoves = null
      const result = manager.submitMove(choice.piece, choice.amount)
      if (!result) fail(ctx, `submitMove rejected an option that was just offered: piece=${choice.piece.color}#${choice.piece.pieceIndex} amount=${choice.amount} kind=${choice.kind}`)

      checkBoardInvariants(players, ctx)
      checkArrivedAt()
      checkFinishedNeverMoves()
    }

    // Every roll must resolve to *something* observable: a "no legal move" event, a fresh turn
    // (own or the next player's), or an outright win - never silently vanish with the dice just
    // dropped and nothing for the UI to react to.
    if (!won && !moveNotPossibleFiredThisRoll && turnStartedCount === turnStartedBefore) {
      fail(ctx, `roll resolved with no moveNotPossible, no turnStarted, and no win - dice silently dropped`)
    }

    if (won) {
      if (!hasWon(manager.currentPlayer)) fail(ctx, `gameWon fired but hasWon(currentPlayer) is false`)
    }
  }

  return { won, totalSubmits, rollsPlayed: Math.min(maxRolls, ctx.roll + 1) }
}

const PLAYER_COUNTS = [2, 3, 4, 5, 6] as const
// Lets repeated runs explore genuinely different seeds instead of re-driving the exact same
// trials each time (the per-trial seed formulas below are otherwise fully deterministic).
const SEED_OFFSET = Number(process.env.STRESS_SEED_OFFSET ?? 0) * 10_000_019

describe('rule engine full-game simulation invariants', () => {
  for (const playerCount of PLAYER_COUNTS) {
    const def = BOARD_DEFINITIONS[playerCount]
    const board = toBoardData(def)
    const colors = def.playerLanes.map((l) => l.color)

    it(`board_${playerCount}p: fresh-start games never violate invariants (150 trials)`, () => {
      const TRIALS = 400
      const MAX_ROLLS = 400
      let totalRolls = 0
      let wins = 0
      for (let trial = 0; trial < TRIALS; trial++) {
        const seed = SEED_OFFSET + playerCount * 1_000_003 + trial * 97 + 1
        const rng = new Rng(seed)
        const players = colors.map((color) => createPlayerState(color, board))
        const ctx: Ctx = { board, colors, seed, trial, playerCount, density: 'sparse', roll: 0, history: [] }
        const outcome = driveGame(board, players, rng, MAX_ROLLS, ctx)
        totalRolls += outcome.rollsPlayed
        if (outcome.won) wins++
      }
      expect(totalRolls).toBeGreaterThan(0)
      // Not a hard assertion on win rate - just surfacing it for the report; a plausible chunk of
      // fresh games should actually finish within the roll cap.
      // eslint-disable-next-line no-console
      console.log(`board_${playerCount}p fresh-start: ${wins}/${TRIALS} finished within ${MAX_ROLLS} rolls, ${totalRolls} total rolls driven`)
    })

    it(`board_${playerCount}p: scattered mid-game states never violate invariants (250 trials)`, () => {
      const TRIALS = 600
      const MAX_ROLLS = 150
      let totalRolls = 0
      for (let trial = 0; trial < TRIALS; trial++) {
        const seed = SEED_OFFSET + playerCount * 2_000_003 + trial * 131 + 7
        const rng = new Rng(seed)
        const players = randomInitialPlayers(board, colors, rng, 'general')
        const ctx: Ctx = { board, colors, seed, trial, playerCount, density: 'general', roll: 0, history: [] }
        const outcome = driveGame(board, players, rng, MAX_ROLLS, ctx)
        totalRolls += outcome.rollsPlayed
      }
      expect(totalRolls).toBeGreaterThan(0)
    })

    it(`board_${playerCount}p: endgame-biased states (corridor/finish-heavy) never violate invariants (150 trials)`, () => {
      const TRIALS = 400
      const MAX_ROLLS = 150
      let totalRolls = 0
      let finishes = 0
      for (let trial = 0; trial < TRIALS; trial++) {
        const seed = SEED_OFFSET + playerCount * 3_000_017 + trial * 151 + 13
        const rng = new Rng(seed)
        const players = randomInitialPlayers(board, colors, rng, 'endgame')
        const ctx: Ctx = { board, colors, seed, trial, playerCount, density: 'endgame', roll: 0, history: [] }
        const outcome = driveGame(board, players, rng, MAX_ROLLS, ctx)
        totalRolls += outcome.rollsPlayed
        if (outcome.won) finishes++
      }
      expect(totalRolls).toBeGreaterThan(0)
      // eslint-disable-next-line no-console
      console.log(`board_${playerCount}p endgame-biased: ${finishes}/${TRIALS} games won within ${MAX_ROLLS} rolls`)
    })
  }
})
