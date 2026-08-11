import type { PlayerState } from '../core/gameFlow/playerState'
import type { PieceColor } from '../core/pieceColor'
import type { Piece } from '../core/pieces/piece'

/** Looks up a piece by (color, pieceIndex) in a local `players` array - the only two values ever
 * sent over the wire for a move (see protocol.ts for why never the Piece object itself). */
export function findPiece(players: PlayerState[], color: PieceColor, pieceIndex: number): Piece | null {
  const player = players.find((p) => p.color === color)
  return player?.pieces[pieceIndex] ?? null
}
