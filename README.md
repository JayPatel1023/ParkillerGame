# Parkiller — Parchís (Ludo) web app

Milestone 1 build: branded start screen, 5 board variants (2-6 players), local pass-and-play
in the browser. Built with **React + Three.js** (via `@react-three/fiber`), deployable as a static
site (e.g. Vercel).

> Note: this replaces an earlier Unity/C# prototype of the same milestone. Unity produced native
> Android/iOS/Windows builds installable through the app stores, as originally scoped with the
> client; this React/Three.js version is a browser app. If native store apps are still required,
> this stack alone won't produce them without an additional wrapper (e.g. Capacitor/Electron).

## Running it

```
npm install
npm run dev       # local dev server
npm run build     # production build to dist/, what Vercel deploys
npm test          # Vitest unit tests for the rules engine
```

## What's implemented

- `src/core/` — engine code, framework-independent (no React/Three.js imports):
  - `board/boardDefinition.ts` — one `BoardDefinition` object per board variant. All positions
    (track squares, yards, home corridors) are data (normalized `[0..1]` image coordinates), not
    hardcoded, so the same code drives all 5 tableros.
  - `rules/parchisRules.ts` — movement, capture, safe squares, exact-count-to-finish. Ported
    1:1 from the original rules design and covered by `tests/parchisRules.test.ts` (7 tests,
    passing).
  - `gameFlow/turnManager.ts` — turn order, dice rolls, extra turn on six, third-six-forfeits-turn.
  - `gameFlow/localGameSession.ts` — milestone-1 entry point: hotseat, 2-6 real players, no bots
    (bots are an online-only feature per the brief, for filling empty seats in a room).
- `src/scene/` — the Three.js layer (`BoardMesh`, `PieceMesh`, `DiceMesh`, `BoardScene`):
  textured board plane, clickable 3D piece tokens, a rollable dice cube. Reads positions purely
  from `BoardDefinition` waypoints, so it's generic across all 5 boards.
- `src/ui/` — `StartScreen` (brand color placeholders), `PlayerCountSelector`, `GameBoardScreen`.
- `src/tools/WaypointEditor.tsx` — dev tool, open the app with `#editor` in the URL. Click
  directly on each board image to trace the track/yards/home-corridors, then export the JSON and
  paste it into `src/data/boards.ts`. This replaces the old Unity Editor waypoint tool — same
  purpose: each tablero has hand-drawn curves that can't be computed from a formula.
- `tests/parchisRules.test.ts` — unit tests for the rules engine (yard exit, capture, safe
  squares, exact-count finishing). Run with `npm test`.

## Board art received so far

All 5 variants are in `public/boards/`:

| Players | File | Lane colors (art order) |
|---|---|---|
| 2 | `board_2p.jpg` | Red, Blue |
| 3 | `board_3p.jpg` | Red, Blue, Gold |
| 4 | `board_4p.jpg` | Red, Gold, Green, Blue |
| 5 | `board_5p.jpg` | Blue, Gold, Purple, Green, Red |
| 6 | `board_6p.jpg` | Gold, Blue, Purple, Orange, Green, Red |

Note: the file originally named `tablero_de_Parkiller_4.jpg` was actually the **3-player** board
(3 yards visible) — renamed to `board_3p.jpg` accordingly.

## Remaining setup work before milestone 1 is playable end-to-end

1. Open the app at `#editor` and trace waypoints on each of the 5 boards (track squares in
   travel order per lane, each lane's 4 yard slots, each lane's home corridor, entry/home-entrance
   indices, and the star-marked safe squares). Paste the exported JSON into `src/data/boards.ts` —
   right now every board's waypoint arrays are empty, so pieces won't render until this is done.
2. Still needed from Carlos: final logo + exact brand hex colors (placeholders are sampled from
   the board art's parchment/gold palette), piece token art/model, dice art/model.

## Rules implemented (Spanish parchís, standard variant)

- A piece leaves the yard only on rolling a 6.
- Rolling a 6 grants an extra turn; a **third consecutive 6 forfeits the move** and ends the turn
  (no piece movement on that roll).
- Landing exactly on an opponent on a non-safe square sends it back to the yard.
- Star squares (`safeTrackIndices`) protect pieces from capture.
- Reaching the final home corridor square requires an **exact** roll — overshooting is not a valid move.
- First player to get all 4 pieces home wins immediately (classic mobile-app simplification; the
  traditional tabletop rule of continuing to rank 2nd/3rd/etc. is not implemented — flag if Carlos
  expects full ranking).
- Not implemented yet (scope cut, flagged rather than silently skipped): blockades (two own
  pieces on a square blocking opponents from passing).

## Not in this milestone

Online play (rooms, BOT fill-in for empty seats), native store builds/publishing — those were
milestone 2/3 under the original Unity plan and need re-scoping for this stack.
