import { describe, expect, it } from 'vitest'
import { BOARD_DEFINITIONS } from '../src/data/boards'
import { toBoardData } from '../src/core/board/boardDefinition'
import { createPlayerState } from '../src/core/gameFlow/playerState'
import { getValidMoves, applyMove } from '../src/core/rules/parchisRules'
import { defaultRuleSettings } from '../src/core/rules/ruleSettings'

describe('generated board data', () => {
  for (const playerCount of [2, 3, 4, 5, 6]) {
    it(`board_${playerCount}p has consistent, non-degenerate waypoint data`, () => {
      const def = BOARD_DEFINITIONS[playerCount]

      expect(def.playerCount).toBe(playerCount)
      expect(def.playerLanes).toHaveLength(playerCount)
      expect(def.trackWaypoints.length).toBeGreaterThan(playerCount * 4)

      for (const lane of def.playerLanes) {
        expect(lane.yardWaypoints).toHaveLength(4)
        expect(lane.homeCorridorWaypoints.length).toBeGreaterThan(0)
        expect(lane.entryTrackIndex).toBeGreaterThanOrEqual(0)
        expect(lane.entryTrackIndex).toBeLessThan(def.trackWaypoints.length)
        expect(lane.homeEntranceTrackIndex).toBeGreaterThanOrEqual(0)
        expect(lane.homeEntranceTrackIndex).toBeLessThan(def.trackWaypoints.length)
      }

      // every waypoint should be a finite, normalized [0..1] image coordinate
      const allPoints = [
        ...def.trackWaypoints,
        ...def.playerLanes.flatMap((l) => [...l.yardWaypoints, ...l.homeCorridorWaypoints]),
      ]
      for (const [x, y] of allPoints) {
        expect(Number.isFinite(x)).toBe(true)
        expect(Number.isFinite(y)).toBe(true)
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(1)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(1)
      }
    })

    it(`board_${playerCount}p has no large jumps between consecutive track squares (no teleporting pieces)`, () => {
      // A smooth-curve approximation of the track can silently misorder squares on boards whose
      // real path loops back on itself (not star-convex around one center) - two indices that
      // are far apart on the drawn path can end up numerically adjacent. That doesn't fail on
      // structural checks alone: it shows up as a piece "jumping" when moved a small number of
      // steps. Catch it directly by requiring consecutive (and wrap-around) waypoints to stay
      // close, relative to the loop's own average step size.
      const def = BOARD_DEFINITIONS[playerCount]
      const pts = def.trackWaypoints
      const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])

      const gaps = pts.map((p, i) => dist(p, pts[(i + 1) % pts.length]))
      const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length
      // 5x tolerates one slightly-oversized square from sampling noise; the actual bug this
      // guards against (misordered/crossed loop) produced gaps 15-20x the average, not ~4-5x.
      const maxAllowed = avgGap * 5

      const worstIndex = gaps.indexOf(Math.max(...gaps))
      expect(gaps[worstIndex], `gap at index ${worstIndex} is ${gaps[worstIndex].toFixed(3)}, avg is ${avgGap.toFixed(3)}`).toBeLessThan(maxAllowed)
    })

    it(`board_${playerCount}p supports a full playthrough of one piece leaving the yard and reaching home`, () => {
      const def = BOARD_DEFINITIONS[playerCount]
      const board = toBoardData(def)
      const settings = defaultRuleSettings()
      const colors = def.playerLanes.map((l) => l.color)
      const players = colors.map(createPlayerState)
      const mover = players[0]

      // exit the yard
      let moves = getValidMoves(board, mover, 6, settings)
      const exitMove = moves.find((m) => m.kind === 'ExitYard')
      expect(exitMove).toBeTruthy()
      applyMove(board, exitMove!, players, settings)
      expect(mover.pieces[0].state).toBe('OnTrack')

      // walk it all the way home, one step at a time, so every intermediate index gets exercised
      let safety = 0
      while (mover.pieces[0].state !== 'Finished') {
        safety++
        expect(safety).toBeLessThan(1000) // guards against an infinite loop if the data is broken

        moves = getValidMoves(board, mover, 1, settings)
        const move = moves.find((m) => m.piece === mover.pieces[0])
        expect(move).toBeTruthy()
        applyMove(board, move!, players, settings)
      }

      expect(mover.pieces[0].state).toBe('Finished')
    })
  }
})
