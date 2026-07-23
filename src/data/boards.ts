import type { BoardDefinition } from '../core/board/boardDefinition'
import generated from './generated-boards.json'

// Positions here were derived automatically from the delivered board art (see
// scripts/generate-waypoints.mjs) - real yard locations detected by color, a track loop shaped
// and scaled to match those detections. It's a playable approximation, not a pixel-perfect trace
// of every hand-drawn square. For exact alignment, open the app at #editor, trace a board by
// hand, export its JSON, and drop it into src/data/generated-boards.json under that player count.
export const BOARD_DEFINITIONS: Record<number, BoardDefinition> = generated as unknown as Record<number, BoardDefinition>
