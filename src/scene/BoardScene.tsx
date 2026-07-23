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
import { toWorldPosition } from './boardGeometry'

const INTRO_STAGGER = 0.09 // seconds between each piece's drop-in entrance, for a cascading effect

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
            restPosition={toWorldPosition(waypoint)}
            hopFrom={hopFrom}
            hops={hops}
            onHopsComplete={isAnimating ? onAnimationComplete : undefined}
            introDelay={index * INTRO_STAGGER}
            selectable={selectablePieces.has(piece)}
            onSelect={onSelectPiece}
          />
        )
      })}

      <DiceMesh value={diceValue} rolling={rolling} onClick={onRollDice} />
      <OrbitControls enablePan={false} minPolarAngle={0.2} maxPolarAngle={1.2} />
    </Canvas>
  )
}
