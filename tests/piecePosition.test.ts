import { describe, expect, it } from 'vitest'
import type { BoardDefinition } from '../src/core/board/boardDefinition'
import { getHopWaypoints, getParkillerHopWaypoints, getParkillerWaypoint } from '../src/scene/piecePosition'

// Mirrors CAPTURE_REWARD (20) in turnManager.ts plus a few corridor squares, to reproduce a
// legitimate reward move that must NOT collapse to a single instant hop.
function buildLongTrackDefinition(): BoardDefinition {
  const trackLength = 30
  return {
    playerCount: 2,
    boardImage: '',
    trackWaypoints: Array.from({ length: trackLength }, (_, i) => [i, i]) as [number, number][],
    safeTrackIndices: [],
    playerLanes: [
      {
        color: 'Red',
        entryTrackIndex: 0,
        homeEntranceTrackIndex: 25,
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

  it('a large but legitimate reward move (>20 squares, crossing into the corridor) still hops every square instead of collapsing to one jump', () => {
    // Reproduces the reward-move bug: a capture reward moves a piece 20 squares, which combined
    // with crossing into the corridor exceeded the old MAX_PLAUSIBLE_HOPS ceiling of 20 and
    // wrongly collapsed to a single instant hop straight to the destination.
    const definition = buildLongTrackDefinition()
    const before = { state: 'OnTrack' as const, trackPosition: 3, corridorPosition: -1 }
    const after = { state: 'InHomeCorridor' as const, trackPosition: -1, corridorPosition: 3 }

    const hops = getHopWaypoints('Red', before, after, definition)

    // 22 track hops (4..25) + 4 corridor hops = 26 total - well past the old 20-hop ceiling.
    expect(hops.length).toBe(26)
    expect(hops[0]).toEqual([4, 4])
    expect(hops[21]).toEqual([25, 25])
    expect(hops.slice(22)).toEqual([
      [100, 0],
      [100, 1],
      [100, 2],
      [100, 3],
    ])
  })
})

describe('getParkillerWaypoint', () => {
  it('resolves the track waypoint at its current position while InPlay', () => {
    const definition = buildTestDefinition()
    expect(getParkillerWaypoint(5, 'InPlay', definition)).toEqual([5, 5])
  })

  it('is null once Eliminated, regardless of its last position', () => {
    const definition = buildTestDefinition()
    expect(getParkillerWaypoint(5, 'Eliminated', definition)).toBeNull()
  })
})

describe('getParkillerHopWaypoints', () => {
  it('walks backward (decreasing index) one square at a time', () => {
    const definition = buildTestDefinition()
    expect(getParkillerHopWaypoints(8, 5, definition)).toEqual([
      [7, 7],
      [6, 6],
      [5, 5],
    ])
  })

  it('wraps around the end of the track when it decrements past index 0', () => {
    const definition = buildTestDefinition() // trackLength 20
    expect(getParkillerHopWaypoints(1, 18, definition)).toEqual([
      [0, 0],
      [19, 19],
      [18, 18],
    ])
  })
})
