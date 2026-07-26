# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Parkiller is a Spanish parchís (Ludo) web app: 2-6 player boards, local pass-and-play, built with
React + Three.js (`@react-three/fiber`) and deployed as a static site (e.g. Vercel). It replaces
an earlier Unity/C# prototype of the same milestone — this stack alone won't produce native
Android/iOS/Windows store builds without an additional wrapper (e.g. Capacitor/Electron).

## Commands

```
npm install
npm run dev              # local dev server (Vite)
npm run build             # tsc -b && vite build -> dist/, what Vercel deploys
npm test                  # vitest run — rules engine + generated board data tests
npm run generate-boards   # regenerate src/data/generated-boards.json from board art (needs sharp)
```

Run a single test file: `npx vitest run tests/parchisRules.test.ts`

Dev-only routes (open the app with these URL hashes):
- `#editor` — `WaypointEditor`, hand-trace a board's track/yards/home-corridors on top of the art
  and export JSON for `src/data/generated-boards.json`.
- `#component` — `ComponentPreview`, inspect a single track-square component in isolation with
  live angle/color controls, nothing else rendered.

## Architecture

Strict layering, each layer only depends on the one below it:

1. **`src/core/`** — engine code, framework-independent (no React/Three.js imports).
   - `board/boardDefinition.ts` — one `BoardDefinition` per player-count variant (2-6). All
     positions (track squares, yards, home corridors) are data — normalized `[0..1]` image
     coordinates — not hardcoded, so one codepath drives all 5 tableros.
   - `rules/parchisRules.ts` — movement, capture, safe squares, exact-count-to-finish. Covered by
     `tests/parchisRules.test.ts`.
   - `gameFlow/turnManager.ts` — turn order, dice rolls, extra turn on six, third-six-forfeits-turn.
   - `gameFlow/localGameSession.ts` — milestone-1 entry point: hotseat, 2-6 real players, no bots
     (bots are an online-only feature, out of scope for this milestone).

2. **`src/scene/`** — the Three.js layer (`BoardMesh`, `PieceMesh`, `DiceMesh`, `BoardScene`,
   `TrackTile`). Reads positions purely from `BoardDefinition` waypoints, so it's generic across
   all 5 boards. Track squares render as real per-tile components (not a flat board image).
   Pieces are small bouncing balls that animate one visible hop per square moved
   (`piecePosition.ts`'s `getHopWaypoints` reconstructs the exact square-by-square path from
   before/after piece snapshots) rather than gliding or snapping to the destination, so the
   number of squares moved is countable at a glance.

3. **`src/ui/`** — `StartScreen`, `PlayerCountSelector`, `GameBoardScreen`; screen-level React
   components, wired together in `App.tsx` via a simple `Screen` state machine
   (`'start' | 'selectCount' | 'game'`).

4. **`src/tools/`** — dev-only tools (`WaypointEditor`, `ComponentPreview`), routed via URL hash
   in `App.tsx`, not part of the shipped game flow.

### Board data generation

`src/data/generated-boards.json` is auto-generated, not hand-traced, and is what
`src/data/boards.ts` currently loads into `BOARD_DEFINITIONS`. `scripts/generate-waypoints.mjs`
analyzes the board art directly (color/shape detection via `sharp`) to produce a *playable
approximation* of all 5 boards: detected yard positions, a track loop traced along the actual
drawn path (not a smooth curve — an earlier smooth-curve approximation silently misordered
squares on non-circular boards, so a dice roll would visually jump to the wrong square), and
game-logic-correct entry/home-entrance indices. The traced loop is resampled to
`SQUARES_PER_ARM = 13` per lane (arc-length parameterized, preserves ordering) so a single dice
roll covers a visually meaningful fraction of the board.

This is playable but not pixel-perfect. For pixel-accurate alignment on a given board, use the
`#editor` tool to hand-trace it and drop the exported JSON into `generated-boards.json` for that
player count. `scripts/debug_overlay.py` (needs Pillow: `pip install pillow`) renders generated
waypoints over the board image for visual sanity-checking.

`tests/generatedBoards.test.ts` validates the generated data itself (every waypoint in-bounds,
full simulated playthrough succeeds for all 5 boards) — separate from
`tests/parchisRules.test.ts`, which tests the rules engine logic itself.

## Rules implemented (Spanish parchís, standard variant)

- A piece leaves the yard only on rolling a 6.
- Rolling a 6 grants an extra turn; a third consecutive 6 forfeits the move and ends the turn (no
  piece movement on that roll).
- Landing exactly on an opponent on a non-safe square sends it back to the yard.
- Star squares (`safeTrackIndices`) protect pieces from capture.
- Reaching the final home-corridor square requires an exact roll — overshooting is not valid.
- First player to get all 4 pieces home wins immediately (classic mobile-app simplification, not
  the traditional tabletop full-ranking rule).
- Not implemented: blockades (two own pieces on a square blocking opponents from passing) — scope
  cut, flagged rather than silently skipped.

## Not in this milestone

Online play (rooms, bot fill-in for empty seats) and native store builds/publishing — these were
milestone 2/3 under the original Unity plan and need re-scoping for this stack.
