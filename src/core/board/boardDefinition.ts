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
  /** The yard circle itself (not a waypoint players move through) - measured from the art so it can be drawn without the background image. */
  yardVisual: { center: [number, number]; radius: number; holeRadius: number }
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
  /** The center pie-wedge circle (purely decorative, not a waypoint) - measured from the art so it can be drawn without the background image. */
  hubVisual: { center: [number, number]; radius: number }
  /** The board's flat background fill color, measured from the art. */
  backgroundColor: string
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
