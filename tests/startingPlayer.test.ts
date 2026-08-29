import { describe, expect, it } from 'vitest'
import { determineStartingPlayer } from '../src/core/gameFlow/startingPlayer'
import type { BoardData } from '../src/core/board/boardData'
import { createPlayerState } from '../src/core/gameFlow/playerState'
import type { DiceLike } from '../src/core/dice'

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

function buildBoard(): BoardData {
  return {
    playerCount: 2,
    trackLength: 40,
    lanes: {
      Red: { color: 'Red', entryTrackIndex: 0, homeEntranceTrackIndex: 39, corridorLength: 6 },
      Blue: { color: 'Blue', entryTrackIndex: 20, homeEntranceTrackIndex: 19, corridorLength: 6 },
      Green: { color: 'Green', entryTrackIndex: 10, homeEntranceTrackIndex: 9, corridorLength: 6 },
    },
    safeTrackIndices: new Set([0, 10, 20]),
  }
}

describe('determineStartingPlayer', () => {
  it('picks whichever player rolled the highest sum of the two white dice', () => {
    const board = buildBoard()
    const players = [createPlayerState('Red', board), createPlayerState('Blue', board), createPlayerState('Green', board)]
    // Red: 2+3=5, Blue: 4+4=8, Green: 1+1=2 - Blue wins outright, no tie.
    const dice = new ScriptedDice([2, 3, 4, 4, 1, 1])
    const result = determineStartingPlayer(players, dice)

    expect(result.winnerIndex).toBe(1) // Blue
    expect(result.rounds).toEqual([
      [
        { color: 'Red', roll: 5 },
        { color: 'Blue', roll: 8 },
        { color: 'Green', roll: 2 },
      ],
    ])
  })

  it('re-rolls only the tied players until a unique winner emerges, ignoring the players who already lost', () => {
    const board = buildBoard()
    const players = [createPlayerState('Red', board), createPlayerState('Blue', board), createPlayerState('Green', board)]
    // Round 1: Red 3+3=6, Blue 3+3=6 (tied), Green 1+1=2 (eliminated).
    // Round 2 (Red and Blue only): Red 2+2=4, Blue 5+1=6 - Blue wins.
    const dice = new ScriptedDice([3, 3, 3, 3, 1, 1, 2, 2, 5, 1])
    const result = determineStartingPlayer(players, dice)

    expect(result.winnerIndex).toBe(1) // Blue
    expect(result.rounds).toHaveLength(2)
    expect(result.rounds[0]).toEqual([
      { color: 'Red', roll: 6 },
      { color: 'Blue', roll: 6 },
      { color: 'Green', roll: 2 },
    ])
    // Green never rolls again - only the two tied players are re-rolled.
    expect(result.rounds[1]).toEqual([
      { color: 'Red', roll: 4 },
      { color: 'Blue', roll: 6 },
    ])
  })

  it('keeps re-rolling through a tie that persists across multiple rounds', () => {
    const board = buildBoard()
    const players = [createPlayerState('Red', board), createPlayerState('Blue', board)]
    // Round 1: both roll 6 (tied). Round 2: both roll 8 (tied again). Round 3: Red 4, Blue 10 - Blue wins.
    const dice = new ScriptedDice([3, 3, 3, 3, 4, 4, 4, 4, 2, 2, 5, 5])
    const result = determineStartingPlayer(players, dice)

    expect(result.rounds).toHaveLength(3)
    expect(result.winnerIndex).toBe(1) // Blue
  })

  it('a lone player with no tie possible wins on the very first roll', () => {
    const board = buildBoard()
    const players = [createPlayerState('Red', board)]
    const dice = new ScriptedDice([1, 1])
    const result = determineStartingPlayer(players, dice)

    expect(result.winnerIndex).toBe(0)
    expect(result.rounds).toEqual([[{ color: 'Red', roll: 2 }]])
  })
})
