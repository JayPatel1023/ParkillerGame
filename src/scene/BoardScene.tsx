import { Suspense } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Line, OrbitControls, PerspectiveCamera } from '@react-three/drei'
import type { BoardDefinition } from '../core/board/boardDefinition'
import type { PlayerState } from '../core/gameFlow/playerState'
import type { MoveOption } from '../core/rules/moveOption'
import type { Piece } from '../core/pieces/piece'
import type { MoveAnimationRequest } from '../hooks/useTurnManager'
import { BoardMesh } from './BoardMesh'
import { PieceMesh } from './PieceMesh'
import { DiceMesh } from './DiceMesh'
import { TrackTile } from './TrackTile'
import { useBoardColorSampler } from './useBoardColorSampler'
import { getHopWaypoints, getPieceWaypoint } from './piecePosition'
import { toWorldPosition, estimateSquareSize, computeTileCorners, BASE_HEIGHT } from './boardGeometry'
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
          <mesh key={i} position={cur}>
            <sphereGeometry args={[radius, 8, 8]} />
            <meshBasicMaterial color={safeSet.has(i) ? 'yellow' : 'magenta'} />
          </mesh>
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
              <mesh key={i} position={p}>
                <sphereGeometry args={[0.03, 8, 8]} />
                <meshBasicMaterial color={color} />
              </mesh>
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
  /** The rulebook's two white dice, rolled together each turn. */
  diceValues: [number | null, number | null]
  rolling: boolean
  onRollDice: () => void
  moveAnimation: MoveAnimationRequest | null
  onAnimationComplete: () => void
}

export function BoardScene({
  definition,
  players,
  pendingMoves,
  onSelectPiece,
  diceValues,
  rolling,
  onRollDice,
  moveAnimation,
  onAnimationComplete,
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

        const worldPos = toWorldPosition(waypoint)
        const stackKey = stackKeyFor(piece)
        const group = stackKey ? stackGroups.get(stackKey) : undefined
        const restPosition: [number, number, number] = worldPos
        if (group && group.length > 1) {
          const [ox, oz] = STACK_OFFSETS[group.indexOf(piece) % STACK_OFFSETS.length]
          restPosition[0] += ox
          restPosition[2] += oz
        }
        const isAnimating = moveAnimation?.piece === piece
        let hopFrom: [number, number, number] | null = null
        let hops: [number, number, number][] = []
        if (isAnimating && moveAnimation) {
          const lane = definition.playerLanes.find((l) => l.color === piece.color)
          const beforeWaypoint =
            moveAnimation.before.state === 'InYard'
              ? lane?.yardWaypoints[piece.pieceIndex]
              : moveAnimation.before.state === 'OnTrack'
                ? definition.trackWaypoints[moveAnimation.before.trackPosition]
                : lane?.homeCorridorWaypoints[moveAnimation.before.corridorPosition]
          if (beforeWaypoint) {
            hopFrom = toWorldPosition(beforeWaypoint)
            hops = getHopWaypoints(piece.color, moveAnimation.before, moveAnimation.after, definition).map(toWorldPosition)
          }
        }

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
          />
        )
      })}

      <DiceMesh value={diceValues[0]} rolling={rolling} onClick={onRollDice} xOffset={-0.4} />
      <DiceMesh value={diceValues[1]} rolling={rolling} onClick={onRollDice} xOffset={0.4} />
      <TrackDebugPath trackWaypoints={definition.trackWaypoints} safeTrackIndices={definition.safeTrackIndices} />
      <HomeCorridorDebugPath definition={definition} />
      <OrbitControls enablePan={false} minPolarAngle={0.2} maxPolarAngle={1.2} />
    </Canvas>
  )
}
