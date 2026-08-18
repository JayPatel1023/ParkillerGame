import type { PieceColor } from '../pieceColor'

export type ParkillerState = 'InPlay' | 'Eliminated'

// One per player color, separate from that color's 4 regular pieces (see PlayerState). Moves
// automatically on the shared track each turn via its own black die - see PK 1-8 in the rulebook
// (REGLAMENTODELJUEGODELPARCHISPARKILLERINGLESINVERSO.docx). Unlike a Piece, it has no yard/
// corridor/finished states: it starts already in play and either stays in play for the whole game
// or is eliminated once and stays gone - there's no "win" state for it to reach.
export interface Parkiller {
  color: PieceColor
  state: ParkillerState
  trackPosition: number
  /**
   * False until this Parkiller's first actual move. Logically it already sits at
   * `homeEntranceTrackIndex` (so the very first roll's `mod(before - blackDie, trackLength)` lands
   * on the right shared-track square, per PK2/PK3), but the rulebook is explicit that it visually
   * starts "at the finish square in the center of the board", not out on the main loop - reported
   * directly by the client after seeing it rendered at the home-entrance square instead. The scene
   * layer (see getParkillerWaypoint in piecePosition.ts) uses this flag to render at the lane's own
   * center/finish waypoint until the first move actually happens, then switches to trackPosition.
   */
  hasMoved: boolean
}

export function createParkiller(color: PieceColor, homeEntranceTrackIndex: number): Parkiller {
  return {
    color,
    state: 'InPlay',
    trackPosition: homeEntranceTrackIndex,
    hasMoved: false,
  }
}
