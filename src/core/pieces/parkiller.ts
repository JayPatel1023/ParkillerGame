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
}

// Starts at its own lane's home-entrance square (the square regular pieces of this color turn off
// the main loop into their corridor at) rather than literally inside the center hub - the rulebook
// places it "at the finish square in the center", but the board data has no waypoint coordinates
// for the space between the center and the main loop for the Parkiller's own reversed-direction
// entry, so this reuses an existing, already-measured reference point instead of inventing new
// board data. Visually it starts right next to the center corridor entrance, close enough to read
// as "starting from the middle" without needing a separate render-only position.
export function createParkiller(color: PieceColor, homeEntranceTrackIndex: number): Parkiller {
  return {
    color,
    state: 'InPlay',
    trackPosition: homeEntranceTrackIndex,
  }
}
