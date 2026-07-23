import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { BoardDefinition } from '../core/board/boardDefinition'
import type { PlayerState } from '../core/gameFlow/playerState'
import type { MoveOption } from '../core/rules/moveOption'
import type { Piece } from '../core/pieces/piece'
import { BoardMesh } from './BoardMesh'
import { PieceMesh } from './PieceMesh'
import { DiceMesh } from './DiceMesh'
import { getPieceWaypoint } from './piecePosition'
import { toWorldPosition } from './boardGeometry'

interface BoardSceneProps {
  definition: BoardDefinition
  players: PlayerState[]
  pendingMoves: MoveOption[]
  onSelectPiece: (piece: Piece) => void
  diceValue: number | null
  rolling: boolean
  onRollDice: () => void
}

export function BoardScene({ definition, players, pendingMoves, onSelectPiece, diceValue, rolling, onRollDice }: BoardSceneProps) {
  const selectablePieces = new Set(pendingMoves.map((m) => m.piece))

  return (
    <Canvas shadows camera={{ position: [0, 7, 5], fov: 40 }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 8, 2]} intensity={1.1} castShadow />
      <Suspense fallback={null}>
        <BoardMesh imageUrl={definition.boardImage} />
      </Suspense>

      {players.flatMap((player) =>
        player.pieces.map((piece) => {
          const waypoint = getPieceWaypoint(piece, definition)
          if (!waypoint) return null
          return (
            <PieceMesh
              key={`${piece.color}-${piece.pieceIndex}`}
              piece={piece}
              position={toWorldPosition(waypoint)}
              selectable={selectablePieces.has(piece)}
              onSelect={onSelectPiece}
            />
          )
        }),
      )}

      <DiceMesh value={diceValue} rolling={rolling} onClick={onRollDice} />
      <OrbitControls enablePan={false} minPolarAngle={0.2} maxPolarAngle={1.2} />
    </Canvas>
  )
}
