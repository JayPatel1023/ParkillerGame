import { useMemo } from 'react'
import * as THREE from 'three'
import { BASE_HEIGHT } from './boardGeometry'
import { useRobustTexture } from './useRobustTexture'

// Cropped directly from a real, clean square on the delivered board art (see
// public/tiles/tile-source.png for the original crop), rather than an approximated gradient - two
// layers so the gold border can stay a real, untinted gold regardless of which lane color a given
// square is: `tile-fill` is a grayscale luminance map of the real square's shading/bevel, tinted
// per-square via material.color (Three.js multiplies map * color); `tile-border` is the same
// square's gold border only (RGBA, transparent everywhere else), rendered untinted on top.
interface TrackTileProps {
  /** The 4 corners of this tile in world [x, z], in order: prev-left, prev-right, next-right, next-left. */
  corners: [number, number][]
  color: string
}

function buildTrapezoidGeometry(corners: [number, number][]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  // Positions in the mesh's own local XY plane. The parent group rotates -90 around X to lay this
  // flat on the board, which maps local Y to world Z inverted - negate here so world Z ends up
  // matching the corner's actual world-Z (from toWorldPosition) instead of being mirrored.
  const positions = new Float32Array([
    corners[0][0], -corners[0][1], 0,
    corners[1][0], -corners[1][1], 0,
    corners[2][0], -corners[2][1], 0,
    corners[3][0], -corners[3][1], 0,
  ])
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
  const indices = [0, 1, 2, 0, 2, 3]
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

// One repeatable "card" component per track square, shaped as the real trapezoid a square on a
// curved path actually is (wider on the outside of the curve, narrower on the inside) so
// neighboring tiles share an exact edge instead of leaving gaps or overlapping.
export function TrackTile({ corners, color }: TrackTileProps) {
  // useRobustTexture (see its own doc comment) never suspends and retries on failure instead of
  // getting stuck forever - each returns null while loading/retrying. The fill mesh still renders
  // with its own per-square tint even without the map (just a flat color instead of the real
  // bevel/shading); the border mesh is transparent everywhere but the gold border itself, so with
  // no texture yet it's skipped outright rather than rendering as an opaque blank square on top.
  const fillTexture = useRobustTexture('/tiles/tile-fill.png')
  const borderTexture = useRobustTexture('/tiles/tile-border.png')
  const geometry = useMemo(() => buildTrapezoidGeometry(corners), [corners])

  return (
    <group position={[0, BASE_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={geometry} position={[0, 0, -0.006]} receiveShadow>
        {/* Keyed on load state for the same reason as BoardMesh's own material-2 - a material that
            first mounts with map=undefined doesn't reliably pick up texture sampling once map is
            reassigned later, so the tile can stay a flat tinted color forever even after the real
            fetch succeeds. Forcing a fresh material once fillTexture is ready avoids that. */}
        <meshStandardMaterial key={fillTexture ? 'loaded' : 'loading'} map={fillTexture ?? undefined} color={color} />
      </mesh>
      {borderTexture && (
        <mesh geometry={geometry} position={[0, 0, -0.004]}>
          <meshStandardMaterial map={borderTexture} transparent />
        </mesh>
      )}
    </group>
  )
}
