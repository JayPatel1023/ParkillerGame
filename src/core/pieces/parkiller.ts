import type { PieceColor } from '../pieceColor'

export type ParkillerState = 'InPlay' | 'Eliminated'

// One per player color, separate from that color's 4 regular pieces (see PlayerState). Moves
// automatically on the shared track each turn via its own black die - see PK 1-8 in the rulebook
// (REGLAMENTODELJUEGODELPARCHISPARKILLERINGLESINVERSO.docx). Unlike a Piece, it has no yard/
// corridor/finished states of the usual kind - it starts already in play and either stays in play
// for the whole game or is eliminated once and stays gone, there's no "win" state for it to reach -
// but see corridorPosition below for the one real intermediate state it does have.
export interface Parkiller {
  color: PieceColor
  state: ParkillerState
  trackPosition: number
  /**
   * How many of this lane's own home-corridor squares this Parkiller has crossed so far, walking
   * from the center hub out toward the main loop - 0 at the start of the game (still sitting at the
   * center, per PK1's "finish square in the center of the board"), up to corridorLength once fully
   * crossed onto the shared track (trackPosition only becomes meaningful at that point).
   *
   * Reported directly, repeatedly, with concrete examples ("한발자국을 움직여야하는데 8+1=9발자국갔다"
   * - a black die of 1 should mean exactly one square of movement, not 9): earlier attempts treated
   * the center-to-loop distance as extra movement layered on top of the die (an instant jump, a
   * sped-up walk, a smooth glide, then a normal walk) - all four still moved a total distance of
   * corridorLength + dieValue, which the client rejected every time as not matching the die. The
   * only way to make the total distance always equal the die exactly, while still genuinely
   * starting at the center, is to make the very first roll(s) spend the die actually crossing this
   * corridor - see resolveParkillerMove in turnManager.ts, the only place this actually advances.
   */
  corridorPosition: number
  /** This lane's own home-corridor length (see BoardData's own PlayerLaneData.corridorLength) -
   * stored directly on the Parkiller since resolveParkillerMove needs it every single roll to know
   * whether corridorPosition has fully crossed yet, and this is simpler than threading a lane
   * lookup through every call site that touches corridorPosition. */
  corridorLength: number
}

export function createParkiller(color: PieceColor, homeEntranceTrackIndex: number, corridorLength: number): Parkiller {
  return {
    color,
    state: 'InPlay',
    trackPosition: homeEntranceTrackIndex,
    corridorPosition: 0,
    corridorLength,
  }
}
