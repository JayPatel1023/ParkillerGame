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
