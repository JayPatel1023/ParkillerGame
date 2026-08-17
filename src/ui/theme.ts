// Shared design tokens for the "premium tabletop game" look - dark wood, deep green felt, cream
// text, gold trim - reused consistently across the start menu, player-count picker, and in-game
// HUD instead of each screen inventing its own palette. Deliberately separate from
// core/colorPalette.ts, which is real game data (per-player piece colors); this is UI chrome only.
export const THEME = {
  wood: '#241a10',
  woodDeep: '#140d07',
  green: '#152219',
  greenDeep: '#0c140e',
  greenLight: '#1f3326',
  cream: '#f0e6d2',
  creamDim: '#cdbfa0',
  gold: '#c9a24b',
  goldBright: '#e8cf8a',
  goldDeep: '#7a5f26',
  burgundy: '#6e2430',
} as const
