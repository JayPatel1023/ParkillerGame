import { Suspense } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Line, OrbitControls, OrthographicCamera } from '@react-three/drei'
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
import { toWorldPosition, estimateSquareSize, computeTileCorners, BASE_HEIGHT, BOARD_SIZE } from './boardGeometry'

// Fixed zoom made the board render at a constant pixel size regardless of viewport - fine on the
// exact window size it was tuned against, but left large empty margins on any wider/taller
// screen (the whole point of an orthographic top-down view is seeing the whole board at once).
// Recomputes zoom from the canvas's actual pixel size on every resize so the board's own 6x6
// world-unit footprint always fills the shorter viewport dimension, with a small margin so the
// corner ornaments and the dice sitting just past the board edge aren't clipped.
const FIT_MARGIN = 0.86
function FitBoardCamera() {
  const size = useThree((s) => s.size)
  const zoom = (Math.min(size.width, size.height) / BOARD_SIZE) * FIT_MARGIN
  return <OrthographicCamera makeDefault position={[0, 10, 0]} rotation={[-Math.PI / 2, 0, 0]} zoom={zoom} near={0.1} far={50} />
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
  const selectablePieces = new Set(pendingMoves.map((m) => m.piece))
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
        const waypoint = getPieceWaypoint(piece, definition)
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
            const rawHops = getHopWaypoints(piece.color, moveAnimation.before, moveAnimation.after, definition)
            if (rawHops.length > 12) {
              // eslint-disable-next-line no-console
              console.warn(
                '[hop-blowup]',
                definition.playerCount,
                piece.color,
                piece.pieceIndex,
                JSON.stringify({ before: moveAnimation.before, after: moveAnimation.after, hopCount: rawHops.length }),
              )
            }
            hops = rawHops.map(toWorldPosition)
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
      <OrbitControls enablePan={false} minPolarAngle={0.2} maxPolarAngle={1.2} />
    </Canvas>
  )
}
