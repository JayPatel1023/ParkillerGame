import { describe, expect, it } from 'vitest'
import type { BoardDefinition } from '../src/core/board/boardDefinition'
import {
  getCaptureReturnWaypoints,
  getHopWaypoints,
  getParkillerFirstMoveHopWaypoints,
  getParkillerHopWaypoints,
  getParkillerWaypoint,
} from '../src/scene/piecePosition'

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
  it('resolves the track waypoint at its current position while InPlay, once it has moved', () => {
    const definition = buildTestDefinition()
    expect(getParkillerWaypoint({ color: 'Red', state: 'InPlay', trackPosition: 5, hasMoved: true }, definition)).toEqual([5, 5])
  })

  it('resolves to its lane\'s center/finish waypoint before its first move (PK1), ignoring trackPosition', () => {
    const definition = buildTestDefinition()
    expect(getParkillerWaypoint({ color: 'Red', state: 'InPlay', trackPosition: 15, hasMoved: false }, definition)).toEqual([100, 3])
  })

  it('is null once Eliminated, regardless of its last position', () => {
    const definition = buildTestDefinition()
    expect(getParkillerWaypoint({ color: 'Red', state: 'Eliminated', trackPosition: 5, hasMoved: true }, definition)).toBeNull()
  })
})

describe('getCaptureReturnWaypoints', () => {
  it('hops in a straight line from the capture square directly to the piece\'s own yard slot, not along the track', () => {
    const definition = buildTestDefinition() // Red's yardWaypoints[0] is [0, 0]
    const hops = getCaptureReturnWaypoints('Red', 6, 0, definition)

    expect(hops).toEqual([
      [4, 4],
      [2, 2],
      [0, 0],
    ])
  })

  it('is empty for a color with no matching lane', () => {
    const definition = buildTestDefinition()
    expect(getCaptureReturnWaypoints('Blue', 6, 0, definition)).toEqual([])
  })

  it('is empty for a piece index with no yard slot', () => {
    const definition = buildTestDefinition()
    expect(getCaptureReturnWaypoints('Red', 6, 99, definition)).toEqual([])
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

describe('getParkillerFirstMoveHopWaypoints', () => {
  it('goes straight to the entrance square (a smooth glide, not a per-square walk - see ParkillerMesh glideFirstHop), then hops the loop itself', () => {
    // buildTestDefinition's Red lane: homeEntranceTrackIndex 15. The individual homeCorridorWaypoints
    // are deliberately NOT listed one by one here - that read as extra countable hops the die never
    // showed (reported directly) - only the entrance square itself appears, as the glide's target.
    const definition = buildTestDefinition()
    expect(getParkillerFirstMoveHopWaypoints('Red', 12, definition)).toEqual([
      [15, 15], // the home-entrance square - never a "hop" in the normal case (hopFrom sits right
      // there), but hopFrom sits at the center here instead, so this stretch needs it explicitly.
      [14, 14],
      [13, 13],
      [12, 12],
    ])
  })
})
