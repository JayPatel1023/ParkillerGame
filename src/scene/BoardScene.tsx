import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { BoardDefinition } from '../core/board/boardDefinition'
import type { PlayerState } from '../core/gameFlow/playerState'
import type { MoveOption } from '../core/rules/moveOption'
import type { Piece } from '../core/pieces/piece'
import type { MoveAnimationRequest } from '../hooks/useTurnManager'
import { BoardMesh } from './BoardMesh'
import { PieceMesh } from './PieceMesh'
import { DiceMesh } from './DiceMesh'
import { getHopWaypoints, getPieceWaypoint } from './piecePosition'
import { toWorldPosition, estimateSquareSize } from './boardGeometry'

const INTRO_STAGGER = 0.09 // seconds between each piece's drop-in entrance, for a cascading effect

// When multiple pieces land on the same square, they'd otherwise render fully overlapping and
// look like a single piece (or like a piece vanished/jumped oddly when one splits off to move).
// Spread them into a small tight cluster instead, same visual language as the yard's 4 slots.
// Defined as fractions of the board's own square size (not fixed world units) - a 6-player board
// packs in noticeably smaller squares than a 2-player one, and a fixed offset that looked right on
// one spilled pieces into neighboring squares on the other.
const STACK_OFFSET_FRACTIONS: [number, number][] = [
  [0, 0],
  [-0.4, -0.4],
  [0.4, -0.4],
  [-0.4, 0.4],
  [0.4, 0.4],
  [0, -0.55],
]

// Two pieces sharing a square (the common "barrier" case) need to both actually fit inside that
// square rather than just being pushed apart - shrink on boards with smaller squares so they
// don't visually spill past the square's edges or crowd into each other. 0.15 is deliberately
// higher than a single piece's own reference size, so a stacked pair shrinks a bit even on the
// biggest-squared board rather than only kicking in on the denser ones.
const PIECE_SCALE_REFERENCE_SQUARE = 0.15

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
  diceValue: number | null
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
  diceValue,
  rolling,
  onRollDice,
  moveAnimation,
  onAnimationComplete,
}: BoardSceneProps) {
  const selectablePieces = new Set(pendingMoves.map((m) => m.piece))
  const allPieces = players.flatMap((player) => player.pieces)
  const squareSize = estimateSquareSize(definition.trackWaypoints)
  const stackedPieceScale = Math.min(1, squareSize / PIECE_SCALE_REFERENCE_SQUARE)

  const stackGroups = new Map<string, Piece[]>()
  for (const piece of allPieces) {
    const key = stackKeyFor(piece)
    if (!key) continue
    if (!stackGroups.has(key)) stackGroups.set(key, [])
    stackGroups.get(key)!.push(piece)
  }

  return (
    <Canvas shadows camera={{ position: [0, 7, 5], fov: 40 }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 8, 2]} intensity={1.1} castShadow />
      <Suspense fallback={null}>
        <BoardMesh imageUrl={definition.boardImage} />
      </Suspense>

      {allPieces.map((piece, index) => {
        const waypoint = getPieceWaypoint(piece, definition)
        if (!waypoint) return null

        const worldPos = toWorldPosition(waypoint)
        const stackKey = stackKeyFor(piece)
        const group = stackKey ? stackGroups.get(stackKey) : undefined
        const restPosition: [number, number, number] = worldPos
        const isStacked = !!group && group.length > 1
        if (isStacked) {
          const [fx, fz] = STACK_OFFSET_FRACTIONS[group!.indexOf(piece) % STACK_OFFSET_FRACTIONS.length]
          restPosition[0] += fx * squareSize
          restPosition[2] += fz * squareSize
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
            scale={isStacked ? stackedPieceScale : 1}
          />
        )
      })}

      <DiceMesh value={diceValue} rolling={rolling} onClick={onRollDice} />
      <OrbitControls enablePan={false} minPolarAngle={0.2} maxPolarAngle={1.2} />
    </Canvas>
  )
}
