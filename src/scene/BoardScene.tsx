import { Suspense, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Line, OrbitControls, PerspectiveCamera, Text } from '@react-three/drei'
import type { BoardDefinition } from '../core/board/boardDefinition'
import type { PlayerState } from '../core/gameFlow/playerState'
import type { ParkillerMoveResult } from '../core/gameFlow/turnManager'
import type { MoveOption } from '../core/rules/moveOption'
import type { Piece } from '../core/pieces/piece'
import type { MoveAnimationRequest } from '../hooks/useTurnManager'
import { BoardMesh } from './BoardMesh'
import { PieceMesh } from './PieceMesh'
import { ParkillerMesh } from './ParkillerMesh'
import { DiceMesh } from './DiceMesh'
import { TrackTile } from './TrackTile'
import { useBoardColorSampler } from './useBoardColorSampler'
import { getHopWaypoints, getParkillerHopWaypoints, getParkillerWaypoint, getPieceWaypoint } from './piecePosition'
import { toWorldPosition, estimateSquareSize, computeTileCorners, BASE_HEIGHT, FLAT_SURFACE_HEIGHT } from './boardGeometry'
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
// On for ongoing verification, at the user's explicit request - leave on until asked to remove
// it. Must be turned back off (false / empty Set) before any client-facing deploy - it was
// accidentally left on once already and the client mistook the debug lines themselves for
// broken track data.
const SHOW_HOME_CORRIDOR_DEBUG = true
const TRACK_DEBUG_PLAYER_COUNTS = new Set([2, 3, 4, 5, 6])

const FOV_DEGREES = 45
const DEFAULT_POLAR_ANGLE = 0.85 // ~49° off vertical - shallower than before so more of the board's far side stays in frame
const CAMERA_DISTANCE = 6.6
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
const STACK_OFFSETS: [number, number][] = [
  [0, 0],
  [-0.11, -0.11],
  [0.11, -0.11],
  [-0.11, 0.11],
  [0.11, 0.11],
  [0, -0.16],
]

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

interface BoardSceneProps {
  definition: BoardDefinition
  players: PlayerState[]
  pendingMoves: MoveOption[]
  onSelectPiece: (piece: Piece) => void
  currentPlayerColor: Piece['color']
  /** The rulebook's two white dice plus the Parkiller's own black die (PK2), all rolled together. */
  diceValues: [number | null, number | null, number | null]
  rolling: boolean
  onRollDice: () => void
  moveAnimation: MoveAnimationRequest | null
  onAnimationComplete: () => void
  parkillerAnimation: ParkillerMoveResult | null
  onParkillerAnimationComplete: () => void
}

export function BoardScene({
  definition,
  players,
  pendingMoves,
  onSelectPiece,
  currentPlayerColor,
  diceValues,
  rolling,
  onRollDice,
  moveAnimation,
  onAnimationComplete,
  parkillerAnimation,
  onParkillerAnimationComplete,
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
    return {
      hopFrom: toWorldPosition(definition.trackWaypoints[parkillerAnimation.before]),
      hops: getParkillerHopWaypoints(parkillerAnimation.before, parkillerAnimation.after, definition).map(toWorldPosition),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parkillerAnimation?.color, parkillerAnimation?.before, parkillerAnimation?.after, definition])

  const stackGroups = new Map<string, Piece[]>()
  for (const piece of allPieces) {
    const key = stackKeyFor(piece)
    if (!key) continue
    if (!stackGroups.has(key)) stackGroups.set(key, [])
    stackGroups.get(key)!.push(piece)
  }

  return (
    <Canvas shadows>
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
        // of letting it jump home before the capturing piece has visually arrived.
        const isBeingCaptured = moveAnimation?.capturedPiece === piece
        const waypoint = isBeingCaptured
          ? (definition.trackWaypoints[moveAnimation!.after.trackPosition] ?? null)
          : getPieceWaypoint(piece, definition)
        if (!waypoint) return null

        const worldPos = toWorldPosition(waypoint, isBeingCaptured ? BASE_HEIGHT : restHeightFor(piece))
        const stackKey = stackKeyFor(piece)
        const group = stackKey ? stackGroups.get(stackKey) : undefined
        const restPosition: [number, number, number] = worldPos
        if (group && group.length > 1) {
          const [ox, oz] = STACK_OFFSETS[group.indexOf(piece) % STACK_OFFSETS.length]
          restPosition[0] += ox
          restPosition[2] += oz
        }
        const isAnimating = moveAnimation?.piece === piece
        const hopFrom = isAnimating ? (animatingHopData?.hopFrom ?? null) : null
        const hops = isAnimating ? (animatingHopData?.hops ?? []) : []

        return (
          <PieceMesh
            key={`${piece.color}-${piece.pieceIndex}`}
            piece={piece}
            restPosition={restPosition}
            hopFrom={hopFrom}
            hops={hops}
            onHopsComplete={isAnimating ? onAnimationComplete : undefined}
            introDelay={index * INTRO_STAGGER}
            selectable={selectablePieces.has(piece)}
            onSelect={onSelectPiece}
            isCurrentTurn={piece.color === currentPlayerColor}
          />
        )
      })}

      {players.map((player, index) => {
        const waypoint = getParkillerWaypoint(player.parkiller.trackPosition, player.parkiller.state, definition)
        if (!waypoint) return null
        const restPosition = toWorldPosition(waypoint, BASE_HEIGHT)
        const isAnimating = parkillerAnimation?.color === player.color
        const hopFrom = isAnimating ? (parkillerHopData?.hopFrom ?? null) : null
        const hops = isAnimating ? (parkillerHopData?.hops ?? []) : []

        return (
          <ParkillerMesh
            key={`parkiller-${player.color}`}
            color={player.color}
            restPosition={restPosition}
            hopFrom={hopFrom}
            hops={hops}
            onHopsComplete={isAnimating ? onParkillerAnimationComplete : undefined}
            introDelay={(allPieces.length + index) * INTRO_STAGGER}
          />
        )
      })}

      <DiceMesh value={diceValues[0]} rolling={rolling} onClick={onRollDice} column={-0.5} />
      <DiceMesh value={diceValues[1]} rolling={rolling} onClick={onRollDice} column={0.5} />
      <DiceMesh value={diceValues[2]} rolling={rolling} onClick={onRollDice} column={0} row={1} black />
      {TRACK_DEBUG_PLAYER_COUNTS.has(definition.playerCount) && (
        <TrackDebugPath trackWaypoints={definition.trackWaypoints} safeTrackIndices={definition.safeTrackIndices} />
      )}
      {SHOW_HOME_CORRIDOR_DEBUG && <HomeCorridorDebugPath definition={definition} />}
      <OrbitControls enablePan={false} minPolarAngle={0.2} maxPolarAngle={1.2} />
    </Canvas>
  )
}
