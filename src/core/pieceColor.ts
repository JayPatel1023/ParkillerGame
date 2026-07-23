export const PIECE_COLORS = ['Red', 'Blue', 'Gold', 'Green', 'Purple', 'Orange'] as const

export type PieceColor = (typeof PIECE_COLORS)[number]
