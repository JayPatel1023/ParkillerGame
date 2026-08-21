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
- `#parkiller-editor` — `ParkillerEditor`, click-trace the Parkiller's body/hood silhouette
  against `public/reference/parkiller-*.png` (the client's own figurine photos) with a live 3D
  preview, for tuning `ParkillerMesh.tsx`'s `DEFAULT_PARKILLER_CONFIG`.
- `#online` — `OnlineLobbyScreen`, create/join a Photon room for online play (see `src/online/`).

The client's official rulebook (`REGLAMENTODELJUEGODELPARCHISPARKILLERINGLESINVERSO.docx`, repo
root) and their original GameMaker Studio implementation (`Parkiller_GameMaker-main/`, kept
in-repo as a reference only — not built or shipped) are both the authoritative source for exact
rule behavior; several rules engine bugs have been root-caused by reading the GML source directly
rather than guessing from the rulebook's prose alone. Reference photos for piece models live in
`public/reference/`.

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

4. **`src/tools/`** — dev-only tools (`WaypointEditor`, `ComponentPreview`, `ParkillerEditor`),
   routed via URL hash in `App.tsx`, not part of the shipped game flow.

5. **`src/online/`** — Photon Realtime networking (`photonClient.ts`), plus `HostTurnManagerBridge`
   (the room's Master Client runs the one authoritative `TurnManager` and broadcasts dice/move
   inputs) and `RemoteTurnManager` (every other client replays those broadcasts against its own
   local `TurnManager`, never trusting a network-serialized result directly — see those files' own
   doc comments for why). Both implement `gameFlow/turnManagerLike.ts`'s `TurnManagerLike`
   interface, which `core/gameFlow/turnManager.ts` also structurally satisfies unmodified, so
   `src/ui/GameBoardScreen.tsx` binds to one shared interface regardless of local vs. online play.

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

## Rules implemented (per the client's official rulebook — two white dice + the Parkiller)

This is the client's actual "Parkiller" ruleset (`REGLAMENTODELJUEGODELPARCHISPARKILLERINGLESINVERSO.docx`),
not the classic single-die variant this milestone started with. Rule codes below (PC*/PK*) match
that document's own section numbers; code comments in `parchisRules.ts`/`turnManager.ts` cite them
directly, and cross-reference `Parkiller_GameMaker-main/` (the client's original implementation)
wherever the rulebook's prose alone was ambiguous.

- **Two white dice** roll together each turn; a piece can move by die A's value, die B's value, or
  their sum — up to two different pieces (or one piece twice) per roll. A piece reachable by both
  dice (to two different squares) offers both as distinct choices rather than silently picking one.
- **PC2.1**: a piece leaves the yard only when a die shows a **5** (or the sum is 5) — not the
  classic 6. Whenever an unspent die's value is the exit roll and a yard piece could use it, that
  specific die is locked to the exit (a same-valued move for a different piece isn't offered as an
  alternative for it), but the *other* die stays completely free to move any piece, in either
  order. A lone opposing pawn already on your own entry square is not captured by this exit — they
  simply coexist; only a *further* own pawn joining that mixed square captures the opponent, even
  though the entry square is otherwise a safe zone.
- **PC2/PC2.4**: never more than two pawns share a square. A barrier (2 pawns, own or mixed) blocks
  every other piece from landing on or passing through that square — except the Parkiller, which
  jumps over barriers freely (PK4).
- **PC3/PK8**: capturing is mandatory *per piece*, not across the whole roll — verified directly
  against the reference implementation (`activarFichasMovibles()`/`wouldComer()` in
  `Parkiller_GameMaker-main`): a piece that could capture with one die can't dodge into a
  non-capturing move for itself, but a *different* piece stays completely free to use either die
  normally, including the very die that would have captured — the rulebook's own "move another pawn
  with the matching number, then the pawn in question" escape hatch.
- **PC4/PC5**: reaching the final home-corridor square requires an exact roll. Capturing a pawn or
  an opposing Parkiller grants "10 x 2" — two independently-resolved 10-square rewards, each
  claimed immediately with a piece already in play or forfeited on its own (a piece able to use one
  of the two never loses it just because the other can't be used); finishing a pawn grants a single
  10.
- **PC2.3**: rolling doubles grants an extra turn; a third consecutive double sends the last-moved
  piece back to its yard (exempt once it's in the home corridor).
- **PK9.1**: a double also obligates breaking an existing barrier of the player's own pawns before
  anything else that roll, ahead of collecting rewards or removing a pawn from the shelter — waived
  if genuinely no legal move can break it that roll ("unless movement is impossible"). Re-checked
  fresh each time moves are offered, so once one of the double's two dice breaks it, the other is
  free again with no separate "already broken this roll" tracking needed.
- **The Parkiller (PK1-8)**: one extra piece per color, moved by its own black die (rolled once per
  actual turn, skipped on a doubles bonus turn), traveling the shared track loop in the *opposite*
  direction from regular pawns. Landing on an opposing pawn sends it home with no reward; landing
  on an opposing Parkiller eliminates it and grants the same "10 x 2" reward as a regular capture,
  but only via a single die's own value during the roll that just produced doubles (PK6) — never
  the sum.
- **PK5**: the reverse also holds — a pawn landing on an unprotected opposing Parkiller (without
  eliminating it) is sent straight back to its own yard instead, with no reward, and the move is
  never blocked outright, it always completes first. On a protected/safe square the two simply
  coexist as a barrier instead (PK4).
- **PK5/PK10**: landing on an existing barrier (2 pawns already sharing that square) never just
  coexists with both — the Parkiller always eliminates exactly one. A pawn sharing the
  Parkiller's own color is protected ahead of one that doesn't ("a pawn protects its Parkiller");
  once color alone doesn't decide it (both share a color, whether that's the Parkiller's own or a
  third one), arrival order breaks the tie via `Piece.arrivedAt`, a turn-sequence counter
  (`TurnManager`'s own `nextArrivalSequence`), stamped whenever a piece lands on a new track
  square.
- First player to get all 4 pieces home wins immediately (classic mobile-app simplification, not
  the traditional tabletop full-ranking rule).
- **PC2.1**: two different-colored opposing pawns already sharing your own entry square are not a
  real barrier (PC2.4 barriers are same-color, or different colors specifically on a protected
  square) — exiting is still allowed, eliminating whichever of the two arrived later, same
  `resolveBarrierElimination` the Parkiller's own barrier landings use.
- Not implemented: PK10.1's ~14 hyper-specific scenarios about
  a Parkiller sitting directly on/near a starting square in combination with various pawn/Parkiller
  counts already there, and PK10.2 (a single Parkiller move eliminating two opposing Parkillers at
  once — the current model only ever resolves one Parkiller-vs-Parkiller collision per landing
  square). Both scope cuts, flagged rather than silently skipped. Also not implemented: the
  rulebook appendix's V1/V2 team and two-color-per-player variants.

## Not in this milestone

Native store builds/publishing (would need a Capacitor/Electron wrapper around this web app).
Online play (rooms, bot fill-in for empty seats) shipped in milestone 2 — see `src/online/`.
