import type { PieceColor } from '../pieceColor'
import type { BoardData, PlayerLaneData } from './boardData'

export interface PlayerLane {
  color: PieceColor
  /** Track index where this color's pieces enter the shared track from the yard. */
  entryTrackIndex: number
  /** Last shared-track index before this color turns off into its own home corridor. */
  homeEntranceTrackIndex: number
  /** Corridor squares leading to the center, in travel order. The last one is the finish square. */
  homeCorridorWaypoints: [number, number][]
  /** The 4 waiting slots inside this color's yard circle. */
  yardWaypoints: [number, number][]
}

// One definition per board variant (2p-6p). Waypoints are normalized [0..1] coordinates over the
// board art image, placed by hand with the waypoint editor tool since each tablero has its own
// hand-drawn curves.
export interface BoardDefinition {
  playerCount: number
  boardImage: string
  /** Squares of the shared track, in travel order. An index into this array IS the track index the rules engine uses. */
  trackWaypoints: [number, number][]
  /** Track indices safe from capture - usually each lane's entry square, marked with a star on the art. */
  safeTrackIndices: number[]
  playerLanes: PlayerLane[]
}

export function toBoardData(definition: BoardDefinition): BoardData {
  const lanes: Partial<Record<PieceColor, PlayerLaneData>> = {}
  for (const lane of definition.playerLanes) {
    lanes[lane.color] = {
      color: lane.color,
      entryTrackIndex: lane.entryTrackIndex,
      homeEntranceTrackIndex: lane.homeEntranceTrackIndex,
      corridorLength: lane.homeCorridorWaypoints.length,
    }
  }

  return {
    playerCount: definition.playerCount,
    trackLength: definition.trackWaypoints.length,
    lanes,
    safeTrackIndices: new Set(definition.safeTrackIndices),
  }
}
