import type { PieceColor } from '../../core/pieceColor'

// Measured directly from the delivered board art (median RGB over all matching-hue pixels,
// board_2p/4p/5p/6p.jpg, split into two clusters by V/brightness) - not approximated. Each lane has
// two real states painted on the art: a light "regular" square and a darker "protected" square
// (see REGLAMENTODELJUEGODELPARCHISPARKILLERINGLESINVERSO.docx section 2.2: protected/safe squares
// are marked in a darker color). These are placeholder-accurate to the current art, not final brand
// hex - swap once Carlos confirms exact brand colors, same caveat as core/colorPalette.ts.
const LANE_TILE_COLORS: Record<PieceColor, { light: string; dark: string }> = {
  Red: { light: '#db5d52', dark: '#a72f23' },
  Blue: { light: '#558299', dark: '#345f75' },
  Gold: { light: '#d9b438', dark: '#c79928' },
  Green: { light: '#37683f', dark: '#27442c' },
  Purple: { light: '#70529d', dark: '#653b83' },
  Orange: { light: '#dc7e3e', dark: '#be5a1f' },
}

// Sampled from a clean, flat stretch of board_2p.jpg's parchment margin - same fill on all 5 boards.
export const BOARD_BACKGROUND_COLOR = '#b2c5af'

export function getTrackTileColor(color: PieceColor, isProtected: boolean): string {
  return isProtected ? LANE_TILE_COLORS[color].dark : LANE_TILE_COLORS[color].light
}
