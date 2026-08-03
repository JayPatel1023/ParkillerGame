import { useEffect, useMemo, useRef } from 'react'
import { extend, useFrame, type BufferGeometryNode } from '@react-three/fiber'
import * as THREE from 'three'
import type { Mesh } from 'three'
import { RoundedBoxGeometry } from 'three-stdlib'

extend({ RoundedBoxGeometry })

declare global {
  namespace JSX {
    interface IntrinsicElements {
      roundedBoxGeometry: BufferGeometryNode<RoundedBoxGeometry, typeof RoundedBoxGeometry>
    }
  }
}

// Board art is a 6x6 world-unit square (BOARD_SIZE), so its own edge sits at 3 in either axis -
// dice need to clear that, not just be "close to it", or they rest on top of real track squares on
// boards whose layout runs close to that edge (reported directly, twice: once resting on the
// bottom edge, again after moving them to the board's right edge - the bottom spot in particular
// left very little headroom before the camera's own frustum cut them off on close-to-square
// viewports). Parked on the board's right side now instead of its near/bottom edge: the tilted
// camera's left-right framing isn't squeezed by the same near-edge foreshortening the bottom edge
// has, so there's more consistent clearance past the board here across viewport shapes.
const SIDE_EDGE = 3.05
const DIE_SPACING = 0.55 // stacked front-to-back along Z instead of side-by-side along X
const DIE_SIZE = 0.5
// The die's own geometry is centered on its local origin, so resting it on the flat board plane
// (y=0) means lifting that center by half the die's height - was a flat 0.35, well above the
// die's own 0.25 half-height, leaving a visible gap/shadow between the die and the board.
const DIE_REST_Y = DIE_SIZE / 2

function pipPositions(value: number): [number, number][] {
  switch (value) {
    case 1:
      return [[0, 0]]
    case 2:
      return [
        [-1, -1],
        [1, 1],
      ]
    case 3:
      return [
        [-1, -1],
        [0, 0],
        [1, 1],
      ]
    case 4:
      return [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]
    case 5:
      return [
        [-1, -1],
        [1, -1],
        [0, 0],
        [-1, 1],
        [1, 1],
      ]
    case 6:
      return [
        [-1, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [1, 1],
      ]
    default:
      return []
  }
}

// A real die's pips are small punched-in hemispheres, not flat printed dots - fake that with a
// tight radial shadow ring around each one so it reads as a dimple even under flat ambient light.
function createDiceFaceTexture(value: number): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // Soft radial vignette instead of a flat fill, closer to glossy injection-molded plastic than a
  // flat card face.
  const bg = ctx.createRadialGradient(size * 0.4, size * 0.35, size * 0.1, size * 0.5, size * 0.5, size * 0.75)
  bg.addColorStop(0, '#ffffff')
  bg.addColorStop(1, '#e9e7e2')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, size, size)

  const pipRadius = size * 0.1
  const margin = size * 0.24
  for (const [px, py] of pipPositions(value)) {
    const cx = size / 2 + px * margin
    const cy = size / 2 + py * margin

    const shadow = ctx.createRadialGradient(cx, cy, pipRadius * 0.2, cx, cy, pipRadius * 1.35)
    shadow.addColorStop(0, 'rgba(0,0,0,0.0)')
    shadow.addColorStop(0.7, 'rgba(0,0,0,0.0)')
    shadow.addColorStop(0.85, 'rgba(0,0,0,0.18)')
    shadow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = shadow
    ctx.beginPath()
    ctx.arc(cx, cy, pipRadius * 1.35, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#1c1c1c'
    ctx.beginPath()
    ctx.arc(cx, cy, pipRadius, 0, Math.PI * 2)
    ctx.fill()

    // Tiny offset highlight so each pip reads as a rounded bead rather than a flat disc.
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.beginPath()
    ctx.arc(cx - pipRadius * 0.3, cy - pipRadius * 0.35, pipRadius * 0.3, 0, Math.PI * 2)
    ctx.fill()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

export function DiceMesh({
  value,
  rolling,
  onClick,
  stackIndex = 0,
}: {
  value: number | null
  rolling: boolean
  onClick: () => void
  /** Front-to-back placement for the second white die - the rulebook's two dice are rolled together. */
  stackIndex?: number
}) {
  const meshRef = useRef<Mesh>(null)
  const wasRolling = useRef(rolling)

  // Six canvas-drawn pip textures, generated once and reused across rolls.
  const faceTextures = useMemo(() => [1, 2, 3, 4, 5, 6].map(createDiceFaceTexture), [])

  // Box face order is [+x, -x, +y (top), -y (bottom), +z, -z]. The current value always sits on
  // top with its real-die complement (sums to 7) on the bottom; the sides just take whatever's
  // left, since the roll animation doesn't track real per-face orientation.
  const materials = useMemo(() => {
    const val = value ?? 1
    const opposite = 7 - val
    const remaining = [1, 2, 3, 4, 5, 6].filter((n) => n !== val && n !== opposite)
    const order = [remaining[0], remaining[1], val, opposite, remaining[2], remaining[3]]
    // Low roughness (not a flat matte card face) + a touch of clearcoat-like sheen from the
    // scene's directional light reads as the smooth, glossy injection-molded plastic in the
    // reference photo, instead of the flat cardboard look a fully matte material gives.
    return order.map(
      (n) =>
        new THREE.MeshPhysicalMaterial({
          map: faceTextures[n - 1],
          roughness: 0.28,
          clearcoat: 0.6,
          clearcoatRoughness: 0.25,
        }),
    )
  }, [value, faceTextures])

  useFrame((_, delta) => {
    if (rolling && meshRef.current) {
      meshRef.current.rotation.x += delta * 10
      meshRef.current.rotation.y += delta * 8
    }
  })

  useEffect(() => {
    // Settle to a clean orientation once the roll resolves, so the face holding the correct pip
    // count actually ends up facing up instead of wherever the spin happened to stop.
    if (wasRolling.current && !rolling && meshRef.current) {
      meshRef.current.rotation.set(0, 0, 0)
    }
    wasRolling.current = rolling
  }, [rolling])

  return (
    <group position={[SIDE_EDGE, DIE_REST_Y, (stackIndex - 0.5) * DIE_SPACING]}>
      <mesh ref={meshRef} castShadow onClick={onClick}>
        {/* Rounded corners/edges (not a sharp cardboard cube) to match the reference die photo -
            RoundedBoxGeometry extends BoxGeometry so it keeps the same 6 face-material groups. */}
        <roundedBoxGeometry args={[DIE_SIZE, DIE_SIZE, DIE_SIZE, 4, DIE_SIZE * 0.16]} />
        {materials.map((mat, i) => (
          <primitive key={i} object={mat} attach={`material-${i}`} />
        ))}
      </mesh>
    </group>
  )
}
