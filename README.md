# Parkiller — Parchís (Ludo) app

Milestone 1 build: branded start screen hooks, 5 board variants (2-6 players), local pass-and-play
on one device. Built in Unity so the same project targets Android, iOS, and Windows.

## Opening the project

1. Install Unity **2022.3 LTS** (or any 2021.3+/2022.x LTS — `ProjectSettings/ProjectVersion.txt` is a
   suggestion, not a hard requirement; Unity Hub will offer to switch versions if needed).
2. Open this folder as a Unity project. Unity will import the scripts and board art and generate
   `Library/`, `.meta` files, etc.
3. For each `Assets/Art/Boards/board_*p.jpg`, select it in the Project window and set
   **Texture Type → Sprite (2D and UI)** in the Inspector, then Apply.

## What's implemented

- `Assets/Scripts/Core/` — engine code, no scene/prefab dependencies beyond MonoBehaviours:
  - `Board/BoardDefinition.cs` — one ScriptableObject asset per board variant. All positions
    (track squares, yards, home corridors) are data, not hardcoded, so the same code drives all
    5 tableros.
  - `Rules/ParchisRules.cs` — movement, capture, safe squares, exact-count-to-finish.
  - `GameFlow/TurnManager.cs` — turn order, dice rolls, extra turn on six, third-six-forfeits-turn.
  - `GameFlow/LocalGameSession.cs` — milestone-1 entry point: hotseat, 2-6 real players, no bots
    (bots are an online-only feature per the brief, for filling empty seats in a room).
- `Assets/Scripts/UI/` — `StartScreenController` (brand color hooks), `PlayerCountSelectorUI`,
  `BoardRenderer` + `PieceView` (placeholder circle pieces until real token art arrives).
- `Assets/Editor/` — two tools that do the tedious part of turning custom board art into a working board:
  - **Parkiller → Setup → Create Board Definitions** menu: one click, creates the 5
    `BoardDefinition` assets in `Assets/Art/Boards/`, pre-wired to the right board image and lane
    colors (see table below).
  - Per-board Inspector tool (on any `BoardDefinition` asset): click buttons to enter "placing"
    mode, then click directly on the board art in the Scene view to drop track/yard/corridor
    waypoints in order. This is the manual, per-board alignment step — each tablero has different
    hand-drawn curves, so it can't be computed from a formula.
- `Assets/Tests/EditMode/ParchisRulesTests.cs` — unit tests for the rules engine (yard exit,
  capture, safe squares, exact-count finishing).

## Board art received so far

All 5 variants are in, organized into `Assets/Art/Boards/`:

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

1. Run **Parkiller → Setup → Create Board Definitions**.
2. Open each of the 5 `BoardDefinition` assets and trace waypoints over the art using the
   Inspector tool (track squares in travel order per lane, then each lane's 4 yard slots and home
   corridor). Set `entryTrackIndex` / `homeEntranceTrackIndex` per lane and `safeTrackIndices`
   (the squares marked with a star on the art).
3. Build the two scenes (Start Screen, Board) and wire the MonoBehaviours together in the
   Inspector — the scripts expose `[SerializeField]` references for exactly this.
4. Still needed from Carlos: final logo + exact brand hex colors (placeholders are sampled from
   the board art's parchment/gold palette), piece token art, dice art.

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

Online play (Photon rooms, BOT fill-in for empty seats), store builds/publishing — that's
milestone 2 per the agreed plan.
