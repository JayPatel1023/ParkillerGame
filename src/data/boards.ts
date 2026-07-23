import type { BoardDefinition, PlayerLane } from '../core/board/boardDefinition'
import type { PieceColor } from '../core/pieceColor'

function emptyLane(color: PieceColor): PlayerLane {
  return {
    color,
    entryTrackIndex: 0,
    homeEntranceTrackIndex: 0,
    homeCorridorWaypoints: [],
    yardWaypoints: [],
  }
}

// Pre-wired to the delivered board art and lane colors observed on each tablero. Waypoints are
// intentionally empty here - trace them with the dev waypoint tool (see src/tools/WaypointEditor.tsx)
// and paste the exported JSON back in per board.
export const BOARD_DEFINITIONS: Record<number, BoardDefinition> = {
  2: {
    playerCount: 2,
    boardImage: '/boards/board_2p.jpg',
    trackWaypoints: [],
    safeTrackIndices: [],
    playerLanes: (['Red', 'Blue'] as PieceColor[]).map(emptyLane),
  },
  3: {
    playerCount: 3,
    boardImage: '/boards/board_3p.jpg',
    trackWaypoints: [],
    safeTrackIndices: [],
    playerLanes: (['Red', 'Blue', 'Gold'] as PieceColor[]).map(emptyLane),
  },
  4: {
    playerCount: 4,
    boardImage: '/boards/board_4p.jpg',
    trackWaypoints: [],
    safeTrackIndices: [],
    playerLanes: (['Red', 'Gold', 'Green', 'Blue'] as PieceColor[]).map(emptyLane),
  },
  5: {
    playerCount: 5,
    boardImage: '/boards/board_5p.jpg',
    trackWaypoints: [],
    safeTrackIndices: [],
    playerLanes: (['Blue', 'Gold', 'Purple', 'Green', 'Red'] as PieceColor[]).map(emptyLane),
  },
  6: {
    playerCount: 6,
    boardImage: '/boards/board_6p.jpg',
    trackWaypoints: [],
    safeTrackIndices: [],
    playerLanes: (['Gold', 'Blue', 'Purple', 'Orange', 'Green', 'Red'] as PieceColor[]).map(emptyLane),
  },
}
