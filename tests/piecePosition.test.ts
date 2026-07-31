import { describe, expect, it } from 'vitest'
import type { BoardDefinition } from '../src/core/board/boardDefinition'
import { getHopWaypoints } from '../src/scene/piecePosition'

function buildTestDefinition(): BoardDefinition {
  const trackLength = 20
  return {
    playerCount: 2,
    boardImage: '',
    trackWaypoints: Array.from({ length: trackLength }, (_, i) => [i, i]) as [number, number][],
    safeTrackIndices: [],
    playerLanes: [
      {
        color: 'Red',
        entryTrackIndex: 0,
        homeEntranceTrackIndex: 15,
        yardWaypoints: [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ],
        homeCorridorWaypoints: [
          [100, 0],
          [100, 1],
          [100, 2],
          [100, 3],
        ],
      },
    ],
  } as unknown as BoardDefinition
}

describe('getHopWaypoints', () => {
  it('a piece already sitting exactly on its own home-entrance square needs zero track hops', () => {
    // Reproduces a real bug: a piece can land exactly on its lane's homeEntranceTrackIndex and
    // stay OnTrack there (parchisRules only switches state to InHomeCorridor once a later move
    // actually carries it past that square). Moving again from that exact spot used to walk the
    // entire loop looking for a break condition it had already stepped past, producing a full
    // extra lap of phantom hops before the real corridor entry.
    const definition = buildTestDefinition()
    const before = { state: 'OnTrack' as const, trackPosition: 15, corridorPosition: -1 }
    const after = { state: 'InHomeCorridor' as const, trackPosition: -1, corridorPosition: 1 }

    const hops = getHopWaypoints('Red', before, after, definition)

    expect(hops).toEqual([
      [100, 0],
      [100, 1],
    ])
  })

  it('a normal track move still walks every intermediate square', () => {
    const definition = buildTestDefinition()
    const before = { state: 'OnTrack' as const, trackPosition: 2, corridorPosition: -1 }
    const after = { state: 'OnTrack' as const, trackPosition: 5, corridorPosition: -1 }

    const hops = getHopWaypoints('Red', before, after, definition)

    expect(hops).toEqual([
      [3, 3],
      [4, 4],
      [5, 5],
    ])
  })

  it('a move that crosses the home entrance in one step still walks in, not around', () => {
    const definition = buildTestDefinition()
    const before = { state: 'OnTrack' as const, trackPosition: 13, corridorPosition: -1 }
    const after = { state: 'InHomeCorridor' as const, trackPosition: -1, corridorPosition: 1 }

    const hops = getHopWaypoints('Red', before, after, definition)

    expect(hops).toEqual([
      [14, 14],
      [15, 15],
      [100, 0],
      [100, 1],
    ])
  })
})
