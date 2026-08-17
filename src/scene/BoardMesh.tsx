import { useTexture } from '@react-three/drei'
import { BOARD_SIZE } from './boardGeometry'

// Requested directly, with a screenshot from a low camera angle showing the board reading as a
// paper-thin decal on the table (a flat plane has zero depth, so its own edge was invisible from
// any oblique angle). Extruded into a thin box instead, with the board art only on the top face -
// which stays exactly at y=0 by extruding *downward* (position.y = -THICKNESS/2), not upward, so
// every position that assumes "the board's playing surface is at y=0" (piece rest heights,
// TrackTile placement - all of boardGeometry.ts) needs no changes at all.
const THICKNESS = 0.3

export function BoardMesh({ imageUrl }: { imageUrl: string }) {
  const texture = useTexture(imageUrl)
  return (
    <mesh position={[0, -THICKNESS / 2, 0]} receiveShadow castShadow>
      <boxGeometry args={[BOARD_SIZE, THICKNESS, BOARD_SIZE]} />
      {/* Box face order is [+x, -x, +y (top), -y (bottom), +z, -z] - only the top face shows the
          board art; the other five are the board's now-visible edge and underside, in a plain
          cream tone matching the board art's own cream border. */}
      <meshStandardMaterial attach="material-0" color="#dccdaa" roughness={0.85} />
      <meshStandardMaterial attach="material-1" color="#dccdaa" roughness={0.85} />
      <meshStandardMaterial attach="material-2" map={texture} />
      <meshStandardMaterial attach="material-3" color="#dccdaa" roughness={0.85} />
      <meshStandardMaterial attach="material-4" color="#dccdaa" roughness={0.85} />
      <meshStandardMaterial attach="material-5" color="#dccdaa" roughness={0.85} />
    </mesh>
  )
}
