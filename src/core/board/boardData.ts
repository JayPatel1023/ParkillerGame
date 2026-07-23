import type { PieceColor } from '../pieceColor'

export interface PlayerLaneData {
  color: PieceColor
  entryTrackIndex: number
  homeEntranceTrackIndex: number
  corridorLength: number
}

// Engine-independent board description consumed by parchisRules. Produced from a BoardDefinition.
export interface BoardData {
  playerCount: number
  trackLength: number
  lanes: Partial<Record<PieceColor, PlayerLaneData>>
  safeTrackIndices: Set<number>
}
