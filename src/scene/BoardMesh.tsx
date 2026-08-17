import { useTexture } from '@react-three/drei'
import { extend } from '@react-three/fiber'
import { RoundedBoxGeometry } from 'three-stdlib'
import { BOARD_SIZE } from './boardGeometry'

// Registration only - the `roundedBoxGeometry` JSX element type itself is already declared
// globally by DiceMesh.tsx (same class), which always mounts alongside this in BoardScene's
// Canvas; redeclaring it here would conflict if the two declarations ever drifted apart.
extend({ RoundedBoxGeometry })

// Requested directly, twice in a row: first for real depth at all (a flat plane read as a
// paper-thin decal from any oblique angle), then that the resulting box read as too thick and
// stiff - "너무 나무판처럼 딱딱하게" (too much like a hard wooden plank). A slimmer slab (0.14, was
// 0.3) with a soft rounded edge (RoundedBoxGeometry, the same trick DiceMesh.tsx already uses for
// its own edges) reads as an elegant lacquered game board instead of a cut block of wood. The top
// face stays exactly at y=0 by extruding downward, not upward, so every position that assumes
// "the board's playing surface is at y=0" (piece rest heights, TrackTile placement - all of
// boardGeometry.ts) needs no changes.
export const BOARD_THICKNESS = 0.14

export function BoardMesh({ imageUrl }: { imageUrl: string }) {
  const texture = useTexture(imageUrl)
  return (
    <mesh position={[0, -BOARD_THICKNESS / 2, 0]} receiveShadow castShadow>
      <roundedBoxGeometry args={[BOARD_SIZE, BOARD_THICKNESS, BOARD_SIZE, 3, BOARD_THICKNESS * 0.35]} />
      {/* Box face order is [+x, -x, +y (top), -y (bottom), +z, -z] - only the top face shows the
          board art; the other five are the board's edge and underside, in a plain cream tone
          matching the board art's own cream border. */}
      <meshStandardMaterial attach="material-0" color="#dccdaa" roughness={0.7} metalness={0.05} />
      <meshStandardMaterial attach="material-1" color="#dccdaa" roughness={0.7} metalness={0.05} />
      <meshStandardMaterial attach="material-2" map={texture} />
      <meshStandardMaterial attach="material-3" color="#dccdaa" roughness={0.7} metalness={0.05} />
      <meshStandardMaterial attach="material-4" color="#dccdaa" roughness={0.7} metalness={0.05} />
      <meshStandardMaterial attach="material-5" color="#dccdaa" roughness={0.7} metalness={0.05} />
    </mesh>
  )
}
