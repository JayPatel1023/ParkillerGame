import type { PieceColor } from './pieceColor'

// Turn order (who goes first, then next, etc.) requested per player count - not the same as each
// board's own playerLanes order, which only fixes where each color's yard/track sits spatially.
// Shared between local play (App.tsx) and online play (OnlineLobbyScreen.tsx) so seat/color
// assignment is consistent either way.
export const TURN_ORDER_BY_COUNT: Record<number, PieceColor[]> = {
  2: ['Red', 'Blue'],
  3: ['Red', 'Gold', 'Blue'],
  4: ['Green', 'Blue', 'Gold', 'Red'],
  5: ['Red', 'Green', 'Purple', 'Gold', 'Blue'],
  6: ['Orange', 'Green', 'Red', 'Purple', 'Gold', 'Blue'],
}
