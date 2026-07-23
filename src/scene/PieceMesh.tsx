import { getColor } from '../core/colorPalette'
import type { Piece } from '../core/pieces/piece'

interface PieceMeshProps {
  piece: Piece
  position: [number, number, number]
  selectable: boolean
  onSelect: (piece: Piece) => void
}

export function PieceMesh({ piece, position, selectable, onSelect }: PieceMeshProps) {
  return (
    <mesh
      position={position}
      castShadow
      onClick={(e) => {
        if (!selectable) return
        e.stopPropagation()
        onSelect(piece)
      }}
      scale={selectable ? 1.15 : 1}
    >
      <cylinderGeometry args={[0.18, 0.22, 0.3, 24]} />
      <meshStandardMaterial color={getColor(piece.color)} emissive={selectable ? getColor(piece.color) : '#000000'} emissiveIntensity={selectable ? 0.4 : 0} />
    </mesh>
  )
}
