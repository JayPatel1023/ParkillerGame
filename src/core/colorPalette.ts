import type { PieceColor } from './pieceColor'

// Placeholder swatches sampled from the delivered board art; swap for exact brand hex values once Carlos confirms them.
const PALETTE: Record<PieceColor, string> = {
  Red: '#ba2828',
  Blue: '#386b94',
  Gold: '#cc9e33',
  Green: '#296b47',
  Purple: '#73529e',
  Orange: '#d18040',
}

export function getColor(color: PieceColor): string {
  return PALETTE[color]
}
