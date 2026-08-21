import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Line, OrbitControls, PerspectiveCamera, Text } from '@react-three/drei'
import * as THREE from 'three'
import type { BoardDefinition } from '../core/board/boardDefinition'
import type { PlayerState } from '../core/gameFlow/playerState'
import type { ParkillerMoveResult } from '../core/gameFlow/turnManager'
import type { MoveOption } from '../core/rules/moveOption'
import type { Piece } from '../core/pieces/piece'
import type { PieceColor } from '../core/pieceColor'
import type { MoveAnimationRequest } from '../hooks/useTurnManager'
import { BoardMesh, BOARD_THICKNESS } from './BoardMesh'
import { PieceMesh } from './PieceMesh'
import { ParkillerMesh } from './ParkillerMesh'
import { DiceMesh } from './DiceMesh'
import { PieceChoiceMarkers } from './PieceChoiceMarkers'
import { TrackTile } from './TrackTile'
import { CaptureImpactEffect } from './CaptureImpactEffect'
import { useBoardColorSampler } from './useBoardColorSampler'
import {
  getCaptureReturnWaypoints,
  getHopWaypoints,
  getParkillerMoveHopWaypoints,
  getParkillerWaypoint,
  getPieceWaypoint,
  parkillerCorridorWaypoint,
} from './piecePosition'
import { toWorldPosition, estimateSquareSize, computeTileCorners, BASE_HEIGHT, FLAT_SURFACE_HEIGHT, BOARD_SIZE } from './boardGeometry'
import { getColor } from '../core/colorPalette'

// Requested look is a real tabletop perspective shot (dramatic near/far foreshortening, board
// filling the frame edge to edge) rather than the flatter, evenly-scaled orthographic view this
// used previously. That orthographic choice traded the dramatic look away on purpose - a
// perspective camera makes elevated points (a piece's own body, sitting above the board on
// BASE_HEIGHT) drift away from their true ground position on screen the further they sit from
// the view's center, whereas orthographic keeps an elevated point visually stacked directly above
// its ground square from any angle. Going back to perspective reintroduces that drift; it reads as
// negligible at this FOV/distance/tilt combination for pieces near the board's center but grows
// toward the corners - acceptable for the requested look, but worth knowing if a piece ever looks
// like it's sitting slightly off its square.
// Both debug overlays below (magenta track path, home-corridor path) were turned on temporarily to
// check piece positioning directly instead of eyeballing screenshots - reported directly to turn
// them back off now that positioning has been verified.
const SHOW_HOME_CORRIDOR_DEBUG = false
const TRACK_DEBUG_PLAYER_COUNTS = new Set<number>()

const FOV_DEGREES = 45
const DEFAULT_POLAR_ANGLE = 0.85 // ~49° off vertical - shallower than before so more of the board's far side stays in frame
// Reported directly (twice now): the default view was too zoomed in - the board (and the dice
// past its edge) were getting cropped at real window sizes instead of sitting comfortably inside
// the frame with margin. Pulled back from 6.6, then again from 9.5 once that still wasn't enough
// margin on an actual wide desktop window.
//
// Reported directly again, from the opposite direction this time, once BOARD_SIZE grew 6 -> 12 to
// give pieces more room: leaving this unchanged let the (now bigger) board fill almost the entire
// screen on the very first turn. A *full* proportional pull-back (12.5 * 12/6 = 25) would restore
// the original on-screen board size exactly, but pieces grew by a smaller factor than the board did
// (1.2x vs 2x - see PIECE_BASE_RADIUS/BOARD_SIZE), so fully compensating the zoom would leave them
// looking smaller on screen than before despite the increase, right back to the complaint that
// prompted growing them. Split the difference: pulled back enough that the board reads noticeably
// smaller than the too-big report, without zooming out so far it erases the piece-size gain.
//
// Scaled again from 19, proportionally with BOARD_SIZE's own 12 -> 17 (19 * 17/12 ~= 26.9, rounded
// to 27) so the board's on-screen size relative to the viewport - already checked against the
// too-big report above - stays exactly as it was this round, while the pieces (grown by a further,
// separate ask this round - see PIECE_BASE_RADIUS) read larger against it than before.
const CAMERA_DISTANCE = 27
// Calibrated (not derived) against BOARD_SIZE=6 at a ~1.6:1 viewport aspect - see FitBoardCamera.
const REFERENCE_MIN_DIMENSION_FACTOR = 620

function FitBoardCamera() {
  const size = useThree((s) => s.size)
  // Perspective framing has no single "zoom" knob - distance itself is what fits the board to the
  // viewport, scaled by the same shorter-viewport-dimension logic the old orthographic zoom used,
  // so the board still fills the frame consistently across window sizes instead of only at the
  // exact size this was tuned against.
  const scale = REFERENCE_MIN_DIMENSION_FACTOR / Math.min(size.width, size.height)
  const distance = CAMERA_DISTANCE * scale
  const y = distance * Math.cos(DEFAULT_POLAR_ANGLE)
  const z = distance * Math.sin(DEFAULT_POLAR_ANGLE)
  return <PerspectiveCamera makeDefault position={[0, y, z]} fov={FOV_DEGREES} near={0.1} far={50} />
}

// A soft-edged dark ellipse baked into a canvas texture, not a real-time WebGL shadow - see the
// comment where this is used for why. Reads as a contact shadow/ambient-occlusion pool grounding
// the board against the CSS photo underneath, without depending on the shadow map at all.
function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)')
  gradient.addColorStop(0.6, 'rgba(0,0,0,0.32)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function ContactShadow() {
  const texture = useMemo(() => createContactShadowTexture(), [])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -BOARD_THICKNESS - 0.004, 0]}>
      <planeGeometry args={[BOARD_SIZE * 1.35, BOARD_SIZE * 1.35]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  )
}

// Debug aid: draws a line through every trackWaypoint in array order, plus a dot at each one (larger
// yellow dot on real safe squares, per safeTrackIndices - so it's directly checkable against the
// board art's own darker-colored safe squares - small magenta dot otherwise) - any place the line
// zigzags or crosses itself is a place the underlying data doesn't follow a smooth path, visible
// directly instead of having to guess from how the tiles render.
//
// Dot radius scales down wherever neighboring squares sit close together (some real tight curves -
// e.g. near idx61-3 on the 2p board - measurably don't have room for each index to get its own full-
// size dot without visually overlapping its neighbors, even though every position is independently
// correct). Capping radius at a fraction of the local gap keeps the *positions* exactly as measured
// while stopping fixed-size dots from reading as a placement error in those spots.
function TrackDebugPath({
  trackWaypoints,
  safeTrackIndices,
}: {
  trackWaypoints: [number, number][]
  safeTrackIndices: readonly number[]
}) {
  const debugHeight = BASE_HEIGHT + 0.03 // above the tiles so the line isn't hidden underneath them
  const safeSet = new Set(safeTrackIndices)
  const n = trackWaypoints.length
  const worldPoints = trackWaypoints.map((wp) => toWorldPosition(wp, debugHeight))
  const linePoints = [...worldPoints, worldPoints[0]] // close the loop back to the start

  return (
    <>
      <Line points={linePoints} color="magenta" lineWidth={3} />
      {trackWaypoints.map((_, i) => {
        const prev = worldPoints[(i - 1 + n) % n]
        const next = worldPoints[(i + 1) % n]
        const cur = worldPoints[i]
        const gap = Math.min(
          Math.hypot(cur[0] - prev[0], cur[2] - prev[2]),
          Math.hypot(cur[0] - next[0], cur[2] - next[2]),
        )
        const baseRadius = safeSet.has(i) ? 0.045 : 0.025
        const radius = Math.min(baseRadius, gap * 0.35)
        return (
          <group key={i}>
            <mesh position={cur}>
              <sphereGeometry args={[radius, 8, 8]} />
              <meshBasicMaterial color={safeSet.has(i) ? 'yellow' : 'magenta'} />
            </mesh>
            <Text position={[cur[0], cur[1] + 0.08, cur[2]]} fontSize={0.055} color="black" outlineWidth={0.006} outlineColor="white">
              {i}
            </Text>
          </group>
        )
      })}
    </>
  )
}

// Debug aid: shows the otherwise-invisible path from each lane's home-entrance square (on the
// main loop) to its own finish circle in the center - the board art draws no squares for this
// stretch at all (confirmed via edge detection on the source image), so without this line there's
// no way to see how a piece actually gets from the outer loop into the middle. Drawn in each
// lane's own color so it's clear which corridor belongs to which player.
function HomeCorridorDebugPath({ definition }: { definition: BoardDefinition }) {
  const debugHeight = BASE_HEIGHT + 0.03
  return (
    <>
      {definition.playerLanes.map((lane) => {
        const entrance = definition.trackWaypoints[lane.homeEntranceTrackIndex]
        const points = [entrance, ...lane.homeCorridorWaypoints].map((wp) => toWorldPosition(wp, debugHeight))
        const color = getColor(lane.color)
        return (
          <group key={lane.color}>
            <Line points={points} color={color} lineWidth={3} />
            {points.map((p, i) => (
              <group key={i}>
                <mesh position={p}>
                  <sphereGeometry args={[0.03, 8, 8]} />
                  <meshBasicMaterial color={color} />
                </mesh>
                <Text position={[p[0], p[1] + 0.08, p[2]]} fontSize={0.05} color={color} outlineWidth={0.006} outlineColor="white">
                  {i === 0 ? `${lane.color[0]}-entrance(${lane.homeEntranceTrackIndex})` : `${lane.color[0]}${i - 1}`}
                </Text>
              </group>
            ))}
          </group>
        )
      })}
    </>
  )
}

const INTRO_STAGGER = 0.09 // seconds between each piece's drop-in entrance, for a cascading effect

// When multiple pieces land on the same square, they'd otherwise render fully overlapping and
// look like a single piece (or like a piece vanished/jumped oddly when one splits off to move).
// Spread them into a small tight cluster instead, same visual language as the yard's 4 slots.
// Reported directly: even with this offset, overlapping pieces still read as one piece - +0.11 was
// already the effective footprint's own radius, so neighbors barely cleared each other's silhouette.
// Widened to +0.16/-0.22 (still inside a track square, checked against estimateSquareSize's own
// per-board minimum). Also widened again after pulling the default camera back further (see
// CAMERA_DISTANCE) for a separate report - everything on the board reads smaller on screen at that
// distance, so the same world-space offset became less visually distinct than when it was tuned.
//
// [along, across] the local track direction at that specific square, NOT fixed world [x, z] - see
// localStackOffset below. Reported directly, with a screenshot: on a curved stretch of track, two
// stacked pawns rendered well off the tile entirely, onto the plain board background next to it.
// A fixed world-space offset only happens to line up with a tile's own footprint on a straight
// section (where the track's local direction is roughly axis-aligned) - computeTileCorners in
// boardGeometry.ts already has to account for this same curvature when sizing a tile's own
// rendered shape, and stacking needs the same local frame, not the board's global axes.
//
// Reported directly, again, with a screenshot: a pawn and the Parkiller sharing a square still
// read as one piece sitting on top of the other, not two pieces beside each other. The first two
// slots below (used for the by-far most common case, exactly 2 occupants - a pawn joining a
// Parkiller, or two pawns forming a barrier) used to be [0, 0] and a diagonal offset - one piece
// stayed dead center while only the *other* moved, so the centered one still read as "under" its
// neighbor instead of the two reading as a symmetric pair. Every slot now moves away from center
// in a mirrored pair, so with 2 occupants both are offset - equally, in opposite directions -
// instead of one sitting exactly where a lone occupant normally would.
//
// Reported directly, a third time, with a screenshot: still spilling past the tile's own drawn
// border, "무질서하게" (in a disorderly way) - these were fixed *world-unit* offsets, tuned by eye
// against roughly one board's own tile size, but real tile size varies noticeably by board
// (estimateSquareSize: ~0.31 world units on the 3-player board's wide tiles vs. ~0.22 on the
// 6-player board's narrow ones - see boardGeometry.ts). A fixed offset that looked fine on one
// board necessarily overshoots a smaller tile on another. These are now *fractions of that
// board's own measured tile size* (applied in localStackOffset below, multiplied by the live
// `tileSize` computed once per board) instead of an absolute world-unit guess, so the same
// relative spacing holds on every board - each board's own stacked pieces stay within roughly
// the same proportion of their own tile, not a constant that only happened to fit one of them.
const STACK_OFFSETS: [number, number][] = [
  [-0.2, -0.2],
  [0.2, 0.2],
  [0.2, -0.2],
  [-0.2, 0.2],
  [0, 0.36],
  [0, -0.36],
]

// Used to shrink crowded pieces (0.6x) so two full-size pieces plus the Parkiller's own larger
// footprint could actually fit inside the smallest boards' tiles without spilling past their
// border - reported directly as an inconsistent-size problem in its own right ("말들의 크기를
// 작게하지말고... 원래의 크기를 가지고" - don't shrink the pieces, keep them at their real size):
// pieces visibly changing size depending on whether their square was shared read as a bug, not a
// clever fix. BOARD_SIZE (boardGeometry.ts) now grows the *tiles* instead - see that constant's own
// comment for the exact math - which was the actual fix; every occupant of a shared square renders
// at its normal, unmodified size now (crowdedScale is still computed and passed through below so
// the plumbing stays in place if a future board's own proportions ever need it again, but 1 means
// it's a no-op today).
const CROWDED_SCALE = 1

// Unit tangent (along the path) and normal (across it) at a given waypoint index, from its
// immediate neighbors - same direction-only math as computeTileCorners' own dirOf, reused here so
// a stacking offset lands relative to the tile's actual orientation instead of the world's fixed
// axes. Waypoints are normalized [0..1] image coordinates, but toWorldPosition scales both axes
// identically (no distortion), so a unit direction computed here is exactly the same unit
// direction in world space too - safe to apply world-unit offset magnitudes directly against it.
function localTangentNormal(waypoints: [number, number][], index: number): { tangent: [number, number]; normal: [number, number] } {
  const n = waypoints.length
  const prev = waypoints[(index - 1 + n) % n] ?? waypoints[index]
  const next = waypoints[(index + 1) % n] ?? waypoints[index]
  const dx = next[0] - prev[0]
  const dy = next[1] - prev[1]
  const len = Math.hypot(dx, dy) || 1e-9
  const tangent: [number, number] = [dx / len, dy / len]
  return { tangent, normal: [-tangent[1], tangent[0]] }
}

// Rotates a STACK_OFFSETS entry (given as *fractions* of this board's own tile size, in local
// [along, across] terms) into a world-space [x, z] offset, using the track's own local direction
// at that waypoint instead of the world's fixed axes - see STACK_OFFSETS' own comment for why on
// both counts. `waypoints` is null for a piece the caller couldn't resolve a lane for (shouldn't
// normally happen); falls back to the raw (unscaled, unrotated) fraction as-is.
function localStackOffset(
  waypoints: [number, number][] | null,
  index: number,
  along: number,
  across: number,
  tileSize: number,
): [number, number] {
  if (!waypoints || !waypoints[index]) return [along, across]
  const { tangent, normal } = localTangentNormal(waypoints, index)
  const scaledAlong = along * tileSize
  const scaledAcross = across * tileSize
  return [scaledAlong * tangent[0] + scaledAcross * normal[0], scaledAlong * tangent[1] + scaledAcross * normal[1]]
}

// Which waypoint array/index a piece's own current square is measured against, for
// localStackOffset above - OnTrack pieces use the shared track loop, InHomeCorridor pieces use
// their own color's private corridor lane (also curved on several boards, same issue either way).
function stackWaypointsFor(piece: Piece, definition: BoardDefinition): { waypoints: [number, number][]; index: number } | null {
  if (piece.state === 'OnTrack') return { waypoints: definition.trackWaypoints, index: piece.trackPosition }
  if (piece.state === 'InHomeCorridor') {
    const lane = definition.playerLanes.find((l) => l.color === piece.color)
    return lane ? { waypoints: lane.homeCorridorWaypoints, index: piece.corridorPosition } : null
  }
  return null
}

// Only OnTrack pieces stand on a raised TrackTile mesh (see BASE_HEIGHT); every other state rests
// directly on the flat board texture and needs FLAT_SURFACE_HEIGHT instead, or it visibly floats
// above its own square.
function restHeightFor(piece: Piece): number {
  return piece.state === 'OnTrack' ? BASE_HEIGHT : FLAT_SURFACE_HEIGHT
}

function stackKeyFor(piece: Piece): string | null {
  if (piece.state === 'OnTrack') return `track-${piece.trackPosition}`
  if (piece.state === 'InHomeCorridor') return `corridor-${piece.color}-${piece.corridorPosition}`
  return null // InYard has its own 4 distinct slots already; Finished pieces don't need separating
}

// A Parkiller shares the same track squares pawns walk (including opposing colors', on safe
// squares) but is a different type entirely (Parkiller, not Piece) - rendered in its own separate
// loop below, not part of `allPieces`. Reported directly: a Parkiller sharing a square with a pawn
// still rendered fully overlapping even after the pawn-only stacking above was widened, since the
// Parkiller was never part of that grouping at all. Both loops now build one shared stackGroups
// map (identity strings, not object references, since the two loops can't compare a Piece and a
// Parkiller by reference) so every occupant of a square - pawns and Parkillers together - ends up
// in the same offset cluster.
function pawnOccupantId(piece: Piece): string {
  return `pawn-${piece.color}-${piece.pieceIndex}`
}

function parkillerOccupantId(color: PieceColor): string {
  return `parkiller-${color}`
}

// Still crossing its own lane's home corridor (see Parkiller.corridorPosition's own doc comment)?
// trackPosition is stale (still sitting at homeEntranceTrackIndex, unmoved) - reported directly as
// a real visual bug: a pawn that had just exited onto that exact entrance square got an unwanted
// stack offset applied, as if a Parkiller still visually back in the corridor were actually sharing
// its square, when it wasn't there at all.
function parkillerStackKey(parkiller: PlayerState['parkiller']): string | null {
  if (parkiller.state !== 'InPlay') return null
  if (parkiller.corridorPosition < parkiller.corridorLength) return null
  return `track-${parkiller.trackPosition}`
}

interface CaptureFlight {
  hopFrom: [number, number, number]
  hops: [number, number, number][]
}

interface CaptureImpact {
  id: number
  position: [number, number, number]
  color: string
}

interface BoardSceneProps {
  definition: BoardDefinition
  players: PlayerState[]
  pendingMoves: MoveOption[]
  onSelectPiece: (piece: Piece) => void
  currentPlayerColor: Piece['color']
  /** The rulebook's two white dice plus the Parkiller's own black die (PK2), all rolled together. */
  diceValues: [number | null, number | null, number | null]
  rolling: boolean
  /** True once the current player has left their turn unrolled past the idle threshold - see
   * GameBoardScreen.tsx's own idle timer. */
  nudgeDice: boolean
  onRollDice: () => void
  moveAnimation: MoveAnimationRequest | null
  onAnimationComplete: () => void
  parkillerAnimation: ParkillerMoveResult | null
  onParkillerAnimationComplete: () => void
  /** Set only when the just-clicked piece has more than one legal amount to move by (reachable by
   * both dice, or a die and the sum) - see PieceChoiceMarkers' own comment for why this floats
   * small clickable markers above the piece itself instead of a flat 2D dialog. */
  pieceChoice: { piece: Piece; amounts: number[] } | null
  onChoosePieceAmount: (amount: number) => void
}

export function BoardScene({
  definition,
  players,
  pendingMoves,
  onSelectPiece,
  currentPlayerColor,
  diceValues,
  rolling,
  nudgeDice,
  onRollDice,
  moveAnimation,
  onAnimationComplete,
  parkillerAnimation,
  onParkillerAnimationComplete,
  pieceChoice,
  onChoosePieceAmount,
}: BoardSceneProps) {
  // While a move is still animating, its `hops` reconstruction runs against the piece's already-
  // fully-updated logical state (game rules apply moves instantly; only the visual hop-by-hop
  // playback takes time). If a second move were submitted before that playback finishes,
  // `moveAnimation` - a single slot, not a queue - would be overwritten mid-flight: the first
  // move's PieceMesh would see its `hops` prop change out from under it and, per the reset in
  // PieceMesh's `useEffect(() => {...}, [hops])`, snap straight to wherever it had logically ended
  // up (its `restPosition`) instead of finishing its own hop sequence, then play the second move's
  // hops on top - reproduced directly: a piece rolled 5 visibly hopping only 4 squares, or (for two
  // dice) a piece appearing to teleport to the first die's destination before hopping the second
  // die's distance, instead of visibly hopping both in sequence. Gating selectability on
  // `!moveAnimation` (same guard the roll button already uses) makes that overwrite impossible - a
  // piece can't be picked for its next move until the current one's animation has actually finished.
  const selectablePieces = new Set(moveAnimation ? [] : pendingMoves.map((m) => m.piece))
  const allPieces = players.flatMap((player) => player.pieces)
  const sampleColor = useBoardColorSampler(definition.boardImage)
  const tileSize = estimateSquareSize(definition.trackWaypoints)

  // Recomputing hops/hopFrom inline in the render below (as this used to) builds a brand new
  // array every time BoardScene re-renders, even though `moveAnimation` itself hasn't changed -
  // and PieceMesh's own `useEffect(() => {...}, [hops])` resets its hop progress back to the
  // start on any new array reference, not just a logically new move. `moveAnimation` is a stable
  // object for the whole duration of one animation (only replaced by chooseMove/cleared by
  // clearMoveAnimation - see useTurnManager), but anything else re-rendering BoardScene mid-flight
  // (dice state, pending-move updates, OrbitControls) was enough to restart the current hop from
  // hop 0 - reproduced directly as the reported "sometimes smooth, sometimes erratic" playback:
  // smooth when nothing else re-rendered during that particular move, stuttering/zipping when it
  // did. Memoized on moveAnimation's own primitive fields so the array is only rebuilt when the
  // move itself actually changes.
  const animatingHopData = useMemo(() => {
    if (!moveAnimation) return null
    const { piece, before, after } = moveAnimation
    const lane = definition.playerLanes.find((l) => l.color === piece.color)
    const beforeWaypoint =
      before.state === 'InYard'
        ? lane?.yardWaypoints[piece.pieceIndex]
        : before.state === 'OnTrack'
          ? definition.trackWaypoints[before.trackPosition]
          : lane?.homeCorridorWaypoints[before.corridorPosition]
    if (!beforeWaypoint) return null
    return {
      hopFrom: toWorldPosition(beforeWaypoint),
      hops: getHopWaypoints(piece.color, before, after, definition).map(toWorldPosition),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    moveAnimation?.piece,
    moveAnimation?.before.state,
    moveAnimation?.before.trackPosition,
    moveAnimation?.before.corridorPosition,
    moveAnimation?.after.state,
    moveAnimation?.after.trackPosition,
    moveAnimation?.after.corridorPosition,
    definition,
  ])

  // Same memoization reasoning as animatingHopData above, for the Parkiller's own auto-resolved
  // move - parkillerAnimation is a stable object for one move's whole duration (see useTurnManager),
  // so this only recomputes when the move itself changes, not on every unrelated re-render.
  const parkillerHopData = useMemo(() => {
    if (!parkillerAnimation) return null
    // PK1: while still crossing its own lane's home corridor (see Parkiller.corridorPosition's own
    // doc comment), the Parkiller's hop-origin is the matching corridor waypoint, not the home-
    // entrance track square its logical `before` might otherwise suggest - once fully crossed, it's
    // a real trackWaypoints position like any later move.
    const lane = definition.playerLanes.find((l) => l.color === parkillerAnimation.color)
    const corridorLength = lane?.homeCorridorWaypoints.length ?? 0
    const fromWaypoint =
      parkillerAnimation.beforeCorridorPosition < corridorLength
        ? (parkillerCorridorWaypoint(parkillerAnimation.color, parkillerAnimation.beforeCorridorPosition, definition) ??
          definition.trackWaypoints[parkillerAnimation.before])
        : definition.trackWaypoints[parkillerAnimation.before]
    const hops = getParkillerMoveHopWaypoints(
      parkillerAnimation.color,
      { trackPosition: parkillerAnimation.before, corridorPosition: parkillerAnimation.beforeCorridorPosition },
      { trackPosition: parkillerAnimation.after, corridorPosition: parkillerAnimation.afterCorridorPosition },
      definition,
    )
    return {
      hopFrom: toWorldPosition(fromWaypoint),
      hops: hops.map(toWorldPosition),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    parkillerAnimation?.color,
    parkillerAnimation?.before,
    parkillerAnimation?.after,
    parkillerAnimation?.beforeCorridorPosition,
    parkillerAnimation?.afterCorridorPosition,
    definition,
  ])

  // Rules apply a capture the instant a move is submitted, but the captured piece only stops
  // rendering frozen at the capture square (see isBeingCaptured below) once the capturing piece's
  // own hop animation finishes - up to that point it's just a plain instant teleport home, which
  // reads as the piece quietly vanishing rather than getting sent back. These two effects catch
  // exactly that trailing-edge moment (moveAnimation/parkillerAnimation going from "had a capture"
  // to null) and kick off a short "flung home" hop animation plus an impact flash at the capture
  // square, entirely as presentation on top of state that's already resolved - it doesn't gate or
  // delay anything else about turn flow.
  const [captureFlights, setCaptureFlights] = useState<Map<Piece, CaptureFlight>>(new Map())
  const [impacts, setImpacts] = useState<CaptureImpact[]>([])
  const nextImpactIdRef = useRef(0)
  const prevMoveAnimationRef = useRef<MoveAnimationRequest | null>(null)
  const prevParkillerAnimationRef = useRef<ParkillerMoveResult | null>(null)

  const spawnCaptureEffects = (captureTrackPosition: number, capturedPiece: Piece | null, capturedParkillerColor: PieceColor | null) => {
    const fromWaypoint = definition.trackWaypoints[captureTrackPosition]
    if (!fromWaypoint) return
    const impactColor = getColor(capturedPiece ? capturedPiece.color : capturedParkillerColor!)
    setImpacts((prev) => [...prev, { id: nextImpactIdRef.current++, position: toWorldPosition(fromWaypoint, BASE_HEIGHT), color: impactColor }])
    if (capturedPiece) {
      const hops = getCaptureReturnWaypoints(capturedPiece.color, captureTrackPosition, capturedPiece.pieceIndex, definition).map(toWorldPosition)
      setCaptureFlights((prev) => new Map(prev).set(capturedPiece, { hopFrom: toWorldPosition(fromWaypoint, BASE_HEIGHT), hops }))
    }
  }

  useEffect(() => {
    const prevMove = prevMoveAnimationRef.current
    if (!moveAnimation && prevMove && (prevMove.capturedPiece || prevMove.capturedParkillerColor)) {
      spawnCaptureEffects(prevMove.after.trackPosition, prevMove.capturedPiece, prevMove.capturedParkillerColor)
    }
    prevMoveAnimationRef.current = moveAnimation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveAnimation, definition])

  useEffect(() => {
    const prevParkiller = prevParkillerAnimationRef.current
    if (!parkillerAnimation && prevParkiller && (prevParkiller.capturedPawn || prevParkiller.capturedParkillerColor)) {
      spawnCaptureEffects(prevParkiller.after, prevParkiller.capturedPawn, prevParkiller.capturedParkillerColor)
    }
    prevParkillerAnimationRef.current = parkillerAnimation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parkillerAnimation, definition])

  const stackGroups = new Map<string, string[]>()
  function addToStack(key: string | null, id: string) {
    if (!key) return
    if (!stackGroups.has(key)) stackGroups.set(key, [])
    stackGroups.get(key)!.push(id)
  }
  for (const piece of allPieces) addToStack(stackKeyFor(piece), pawnOccupantId(piece))
  for (const player of players) addToStack(parkillerStackKey(player.parkiller), parkillerOccupantId(player.color))

  return (
    <Canvas shadows gl={{ alpha: true }}>
      {/* Orthographic, exactly vertically overhead instead of the earlier angled perspective
          camera: a piece sits at some height above the flat board (BASE_HEIGHT + its own
          bounce/geometry), and under a perspective camera an elevated object visibly shifts away
          from its true ground position - confirmed directly, pieces were rendering offset from
          their own yard holes. An orthographic camera removes that parallax, but only if it's
          truly vertical - an earlier version nudged position.z off zero to dodge the lookAt
          up-vector singularity, and that small remaining tilt still shifted elevated pieces
          slightly (confirmed - the offset shrank but didn't fully disappear). Setting rotation
          explicitly instead of relying on lookAt sidesteps the singularity without needing any
          tilt at all, so position can stay exactly [0, 10, 0]. Zoom itself is computed in
          FitBoardCamera from the live canvas size, not a fixed constant. */}
      <FitBoardCamera />
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 8, 2]} intensity={1.1} castShadow />
      {/* Reported directly, calling the procedural wood table "한심하다" (pathetic): no more 3D
          ground plane at all - the Canvas is transparent (gl alpha:true) and the real photo
          (moon.png, supplied directly) is the page's own CSS background behind it instead, same
          approach as StartScreen's own background photo. The board now reads as floating over a
          real photo rather than a procedurally-textured plane.
          Removing the ground plane also removed the one thing the board's own shadow used to fall
          on, though - reported directly, right after, that the board now looked like it was
          floating rather than resting on the cloth. A real-time shadowMaterial catcher plane
          turned out not to work here - confirmed via a plain test box that its own shadow lands
          correctly on the board's top surface (the light/shadow system itself is fine), but the
          thin board casts nothing onto a receiver placed below it, even far below and with
          explicit shadow-camera bounds/bias - a peter-panning/culling quirk with this specific
          thin-geometry-over-receiver setup, not worth chasing further. A baked soft-edged dark
          ellipse texture (ContactShadow below) gives the same "resting on the table" cue directly,
          with no dependency on the WebGL shadow map at all. */}
      <ContactShadow />
      <Suspense fallback={null}>
        <BoardMesh imageUrl={definition.boardImage} />
      </Suspense>

      {/* Prototype: each track square rendered as its own repeatable tile, cropped directly from a
          real square on the delivered board art (see public/tiles/), positioned/rotated from the
          real measured waypoints, and tinted per-square by sampling that exact spot's real pixel
          color from the board art - rather than relying on the flat background image to show the
          squares. Overlaid on top of BoardMesh for comparison. */}
      <Suspense fallback={null}>
        {sampleColor &&
          (() => {
            const worldPoints: [number, number][] = definition.trackWaypoints.map((wp) => {
              const w = toWorldPosition(wp)
              return [w[0], w[2]]
            })
            return definition.trackWaypoints.map((wp, i) => (
              <TrackTile
                key={`tile-${i}`}
                corners={computeTileCorners(worldPoints, i, tileSize / 2)}
                color={sampleColor(wp[0], wp[1])}
              />
            ))
          })()}
      </Suspense>

      {allPieces.map((piece, index) => {
        // Capture applies to the captured piece's own state (InYard) the instant the move is
        // submitted, same as every other rule - only the capturing piece's hop animation takes
        // real time. Render the captured piece frozen at the square it was captured on (the
        // capturing piece's own destination) for as long as that animation is in flight, instead
        // of letting it jump home before the capturing piece has visually arrived. A pawn can be
        // captured by another pawn's move (moveAnimation) or by an opposing Parkiller's own move
        // (parkillerAnimation, PK5) - reported directly that the latter was missing this treatment
        // entirely, so the eaten piece vanished before the Parkiller's hop visually arrived.
        const capturedByPawnMove = moveAnimation?.capturedPiece === piece
        const capturedByParkiller = parkillerAnimation?.capturedPawn === piece
        const isBeingCaptured = capturedByPawnMove || capturedByParkiller
        const captureTrackPosition = capturedByPawnMove ? moveAnimation!.after.trackPosition : parkillerAnimation?.after
        const waypoint = isBeingCaptured
          ? (definition.trackWaypoints[captureTrackPosition!] ?? null)
          : getPieceWaypoint(piece, definition)
        if (!waypoint) return null

        const worldPos = toWorldPosition(waypoint, isBeingCaptured ? BASE_HEIGHT : restHeightFor(piece))
        const stackKey = stackKeyFor(piece)
        const group = stackKey ? stackGroups.get(stackKey) : undefined
        const restPosition: [number, number, number] = worldPos
        const crowded = Boolean(group && group.length > 1)
        if (group && group.length > 1) {
          const [along, across] = STACK_OFFSETS[group.indexOf(pawnOccupantId(piece)) % STACK_OFFSETS.length]
          const stackWp = stackWaypointsFor(piece, definition)
          const [ox, oz] = localStackOffset(stackWp?.waypoints ?? null, stackWp?.index ?? -1, along, across, tileSize)
          restPosition[0] += ox
          restPosition[2] += oz
        }
        const isAnimating = moveAnimation?.piece === piece
        // Once the freeze above ends, a piece just captured plays its own short "flung home" hop
        // animation (see spawnCaptureEffects) instead of snapping straight to restPosition - which
        // by now is already its real yard slot, so the flight's own hops lead there directly.
        const captureFlight = captureFlights.get(piece)
        const hopFrom = isAnimating ? (animatingHopData?.hopFrom ?? null) : (captureFlight?.hopFrom ?? null)
        const hops = isAnimating ? (animatingHopData?.hops ?? []) : (captureFlight?.hops ?? [])
        const onHopsComplete = isAnimating
          ? onAnimationComplete
          : captureFlight
            ? () =>
                setCaptureFlights((prev) => {
                  const next = new Map(prev)
                  next.delete(piece)
                  return next
                })
            : undefined

        return (
          <PieceMesh
            key={`${piece.color}-${piece.pieceIndex}`}
            piece={piece}
            restPosition={restPosition}
            hopFrom={hopFrom}
            hops={hops}
            onHopsComplete={onHopsComplete}
            introDelay={index * INTRO_STAGGER}
            selectable={selectablePieces.has(piece)}
            onSelect={onSelectPiece}
            isCurrentTurn={piece.color === currentPlayerColor}
            crowdedScale={crowded ? CROWDED_SCALE : 1}
          />
        )
      })}

      {impacts.map((impact) => (
        <CaptureImpactEffect
          key={impact.id}
          position={impact.position}
          color={impact.color}
          onComplete={() => setImpacts((prev) => prev.filter((i) => i.id !== impact.id))}
        />
      ))}

      {players.map((player, index) => {
        // A Parkiller can be eliminated by a pawn's move (moveAnimation, PK6) or by another
        // Parkiller's own move (parkillerAnimation, PK6) - its trackPosition is preserved even
        // after state flips to Eliminated (see captureParkillerAt/resolveParkillerMove), so it
        // can render frozen there for as long as the capturing animation is in flight, same
        // treatment a captured pawn gets above. Reported directly that this was missing entirely,
        // so an eliminated Parkiller vanished before the capturing piece had visually arrived.
        const isBeingCaptured =
          moveAnimation?.capturedParkillerColor === player.color || parkillerAnimation?.capturedParkillerColor === player.color
        const waypoint = isBeingCaptured
          ? (definition.trackWaypoints[player.parkiller.trackPosition] ?? null)
          : getParkillerWaypoint(player.parkiller, definition)
        if (!waypoint) return null
        const restPosition: [number, number, number] = toWorldPosition(waypoint, BASE_HEIGHT)
        const parkillerStackGroupKey = parkillerStackKey(player.parkiller)
        const parkillerGroup = parkillerStackGroupKey ? stackGroups.get(parkillerStackGroupKey) : undefined
        const parkillerCrowded = Boolean(parkillerGroup && parkillerGroup.length > 1)
        if (parkillerGroup && parkillerGroup.length > 1) {
          const [along, across] = STACK_OFFSETS[parkillerGroup.indexOf(parkillerOccupantId(player.color)) % STACK_OFFSETS.length]
          const [ox, oz] = localStackOffset(definition.trackWaypoints, player.parkiller.trackPosition, along, across, tileSize)
          restPosition[0] += ox
          restPosition[2] += oz
        }
        const isAnimating = parkillerAnimation?.color === player.color
        const hopFrom = isAnimating ? (parkillerHopData?.hopFrom ?? null) : null
        const hops = isAnimating ? (parkillerHopData?.hops ?? []) : []

        // The Parkiller's forward hand marks its direction of travel (reported directly) - PK3:
        // it always walks the shared track loop in decreasing-index order (see
        // getParkillerHopWaypoints), so "the square it's heading to next" is always index-1, even
        // at rest between moves. ParkillerMesh turns to face this every frame.
        const trackLength = definition.trackWaypoints.length
        // Still crossing its own lane's home corridor? Face the next corridor square (toward the
        // loop), not a loop-based index derived from the stale trackPosition it hasn't reached yet.
        const stillInCorridor = player.parkiller.corridorPosition < player.parkiller.corridorLength
        const nextWaypoint = stillInCorridor
          ? (parkillerCorridorWaypoint(player.color, player.parkiller.corridorPosition + 1, definition) ??
            definition.trackWaypoints[definition.playerLanes.find((l) => l.color === player.color)?.homeEntranceTrackIndex ?? player.parkiller.trackPosition])
          : definition.trackWaypoints[(player.parkiller.trackPosition - 1 + trackLength) % trackLength]
        const facingTarget = nextWaypoint ? toWorldPosition(nextWaypoint, BASE_HEIGHT) : restPosition

        return (
          <ParkillerMesh
            key={`parkiller-${player.color}`}
            color={player.color}
            restPosition={restPosition}
            facingTarget={facingTarget}
            hopFrom={hopFrom}
            hops={hops}
            onHopsComplete={isAnimating ? onParkillerAnimationComplete : undefined}
            introDelay={(allPieces.length + index) * INTRO_STAGGER}
            crowdedScale={parkillerCrowded ? CROWDED_SCALE : 1}
          />
        )
      })}

      {pieceChoice &&
        (() => {
          const waypoint = getPieceWaypoint(pieceChoice.piece, definition)
          if (!waypoint) return null
          const anchor = toWorldPosition(waypoint, restHeightFor(pieceChoice.piece))
          return <PieceChoiceMarkers anchor={anchor} amounts={pieceChoice.amounts} onChoose={onChoosePieceAmount} />
        })()}

      <DiceMesh value={diceValues[0]} rolling={rolling} nudge={nudgeDice} onClick={onRollDice} column={-0.5} />
      <DiceMesh value={diceValues[1]} rolling={rolling} nudge={nudgeDice} onClick={onRollDice} column={0.5} />
      <DiceMesh value={diceValues[2]} rolling={rolling} nudge={nudgeDice} onClick={onRollDice} column={0} row={1} black />
      {TRACK_DEBUG_PLAYER_COUNTS.has(definition.playerCount) && (
        <TrackDebugPath trackWaypoints={definition.trackWaypoints} safeTrackIndices={definition.safeTrackIndices} />
      )}
      {SHOW_HOME_CORRIDOR_DEBUG && <HomeCorridorDebugPath definition={definition} />}
      {/* Reported directly, with screenshots: scroll-zoom had no distance limit at all - zooming
          out far enough shrank the board to a speck (or past the far clipping plane entirely,
          leaving just the table and HUD), and there was nothing stopping a stray scroll from
          getting there. minDistance/maxDistance cap both ends - close enough to inspect a piece,
          far enough to see the whole board with margin, never so far it disappears. */}
      <OrbitControls enablePan={false} minPolarAngle={0.2} maxPolarAngle={1.2} minDistance={3.5} maxDistance={22} />
    </Canvas>
  )
}
