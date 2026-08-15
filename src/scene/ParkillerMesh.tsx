import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Group } from 'three'
import { getColor } from '../core/colorPalette'
import type { PieceColor } from '../core/pieceColor'
import { BASE_HEIGHT } from './boardGeometry'
import { BOUNCE_HEIGHT, HOP_DURATION, INTRO_DURATION, INTRO_X_OFFSET, INTRO_Y_START, MAX_FRAME_DELTA, easeOutBounce, easeOutCubic } from './PieceMesh'

interface ParkillerMeshProps {
  color: PieceColor
  restPosition: [number, number, number]
  /** World position of the next track square in this Parkiller's direction of travel (it always
   * walks the shared loop in decreasing-index order) - the forward hand turns to face this, both
   * at rest and mid-hop, so it visually marks which way the piece is heading. */
  facingTarget: [number, number, number]
  /** Set only while this Parkiller is animating its own move; null means "just sit at restPosition". */
  hopFrom: [number, number, number] | null
  hops: [number, number, number][]
  onHopsComplete?: () => void
  introDelay: number
}

// null when `from`/`to` are (near-)identical - happens when a Parkiller is captured/eliminated
// right on the same square it started the frame on, and atan2(0,0) would otherwise snap the
// facing to a meaningless 0 instead of just keeping whatever heading it already had.
function yawTowards(from: [number, number, number], to: [number, number, number]): number | null {
  const dx = to[0] - from[0]
  const dz = to[2] - from[2]
  if (Math.abs(dx) < 1e-5 && Math.abs(dz) < 1e-5) return null
  return Math.atan2(dx, dz)
}

// Body/hood profiles and every mesh position/rotation/scale below are supplied as-is from a
// modeler's own reference build (matched directly against the studio turnaround sheet) - kept
// verbatim in the model's own unit system rather than hand-converted, so it can be diffed directly
// against the source if it ever needs re-syncing. MODEL_SCALE is the only conversion applied.
//
// Reported directly: scaling by the model's own footprint radius (its widest point, 0.5, matched
// to PARKILLER_BASE_RADIUS the way a regular pawn's profile is matched to its own base radius)
// put the whole figure at roughly 2.3x a regular pawn's height - the model's own proportions are
// much more slender (height:radius ~5.8:1) than a pawn's, so matching the footprint overscales
// the height. Matched to height instead - "clearly bigger than a pawn, not just slightly wider"
// was always about height, not footprint - targeting ~1.4x PieceMesh's own total pawn height
// (0.9116 raw * PROFILE_SCALE * PIECE_HEIGHT_SCALE, see PieceMesh.tsx) over this model's own total
// raw height (hood tip at y=2.9).
const PAWN_HEIGHT = 0.9116 * (0.065 / 0.335) * 1.43
const MODEL_RAW_HEIGHT = 2.9
const MODEL_SCALE = (PAWN_HEIGHT * 1.4) / MODEL_RAW_HEIGHT

const BODY_PROFILE_RAW: [number, number][] = [
  [0.03, 0.0],
  [0.38, 0.02],
  [0.48, 0.1],
  [0.5, 0.25],
  [0.48, 0.55],
  [0.44, 0.85],
  [0.38, 1.15],
  [0.4, 1.38],
  [0.48, 1.55],
  [0.42, 1.65],
  [0.28, 1.72],
  [0.03, 1.75],
]

const HOOD_PROFILE_RAW: [number, number][] = [
  [0.03, 1.66],
  [0.25, 1.69],
  [0.36, 1.8],
  [0.42, 1.96],
  [0.43, 2.12],
  [0.4, 2.3],
  [0.34, 2.46],
  [0.26, 2.61],
  [0.16, 2.75],
  [0.07, 2.85],
  [0.01, 2.9],
]

export function ParkillerMesh({ color, restPosition, facingTarget, hopFrom, hops, onHopsComplete, introDelay }: ParkillerMeshProps) {
  const meshRef = useRef<Group>(null)
  const hopIndexRef = useRef(0)
  const elapsedRef = useRef(0)
  const notifiedRef = useRef(true)
  const introRef = useRef({ done: false, elapsed: 0 })

  useEffect(() => {
    hopIndexRef.current = 0
    elapsedRef.current = 0
    notifiedRef.current = hops.length === 0
  }, [hops])

  useFrame((_, rawDelta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const delta = Math.min(rawDelta, MAX_FRAME_DELTA)

    // Baseline heading toward the next square - covers the intro drop and idle rest below.
    // Overridden with the exact per-hop heading further down while actively hopping, so a turn
    // mid-move (the shared loop curves) still updates the facing hop-by-hop instead of only once
    // the whole move settles.
    const restYaw = yawTowards(restPosition, facingTarget)
    if (restYaw !== null) mesh.rotation.y = restYaw

    if (!introRef.current.done) {
      introRef.current.elapsed += delta
      const localT = introRef.current.elapsed - introDelay
      const fromX = restPosition[0] + INTRO_X_OFFSET
      const fromY = INTRO_Y_START
      const fromZ = restPosition[2]

      if (localT < 0) {
        mesh.position.set(fromX, fromY, fromZ)
        return
      }

      const t = Math.min(1, localT / INTRO_DURATION)
      const x = THREE.MathUtils.lerp(fromX, restPosition[0], easeOutCubic(t))
      const z = THREE.MathUtils.lerp(fromZ, restPosition[2], easeOutCubic(t))
      const y = THREE.MathUtils.lerp(fromY, restPosition[1], easeOutBounce(t))
      mesh.position.set(x, y, z)

      if (t >= 1) introRef.current.done = true
      return
    }

    if (hops.length === 0 || !hopFrom || hopIndexRef.current >= hops.length) {
      mesh.position.set(restPosition[0], restPosition[1], restPosition[2])
      if (!notifiedRef.current) {
        notifiedRef.current = true
        onHopsComplete?.()
      }
      return
    }

    elapsedRef.current += delta
    const t = Math.min(1, elapsedRef.current / HOP_DURATION)
    const from = hopIndexRef.current === 0 ? hopFrom : hops[hopIndexRef.current - 1]
    const to = hops[hopIndexRef.current]

    const hopYaw = yawTowards(from, to)
    if (hopYaw !== null) mesh.rotation.y = hopYaw

    const x = THREE.MathUtils.lerp(from[0], to[0], t)
    const z = THREE.MathUtils.lerp(from[2], to[2], t)
    const bounce = Math.sin(t * Math.PI) * BOUNCE_HEIGHT
    mesh.position.set(x, BASE_HEIGHT + bounce, z)

    if (t >= 1) {
      hopIndexRef.current += 1
      elapsedRef.current = 0
    }
  })

  const bodyGeometry = useMemo(() => {
    const points = BODY_PROFILE_RAW.map(([r, y]) => new THREE.Vector2(r, y))
    const geometry = new THREE.LatheGeometry(points, 64)
    geometry.computeVertexNormals()
    return geometry
  }, [])

  const hoodGeometry = useMemo(() => {
    const points = HOOD_PROFILE_RAW.map(([r, y]) => new THREE.Vector2(r, y))
    const geometry = new THREE.LatheGeometry(points, 64)
    geometry.computeVertexNormals()
    return geometry
  }, [])

  // The reference's own red/dark-red pair, generalized to every piece color: main is this piece's
  // own color, dark is the same hue at roughly the reference's own brightness ratio (#700018 is
  // ~0.5x #e0002b) rather than a fixed independent color, so it reads as this piece's own material
  // in shadow instead of a separately-colored part.
  //
  // Reported directly: against this board's actual lighting, the reference's own plain
  // MeshStandardMaterial recipe (roughness 0.18, no clearcoat) read noticeably flatter/more matte
  // than the reference photo's own glossy, lacquered-ceramic look - and flatter than every other
  // piece already on the board, which all use PieceMesh's clearcoat recipe. Switched to that same
  // MeshPhysicalMaterial + clearcoat combination so the Parkiller reads as the same material as
  // every pawn next to it, not a differently-finished piece.
  const mainMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: getColor(color),
        roughness: 0.25,
        metalness: 0.1,
        clearcoat: 0.7,
        clearcoatRoughness: 0.2,
      }),
    [color],
  )
  const darkMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(getColor(color)).multiplyScalar(0.5),
        roughness: 0.3,
        metalness: 0.1,
        clearcoat: 0.5,
        clearcoatRoughness: 0.25,
      }),
    [color],
  )

  return (
    <group ref={meshRef} position={restPosition}>
      <group scale={MODEL_SCALE}>
        {/* Body */}
        <mesh geometry={bodyGeometry} material={mainMaterial} castShadow receiveShadow />

        {/* Pointed hood */}
        <mesh geometry={hoodGeometry} material={mainMaterial} castShadow receiveShadow />

        {/* Dark hollow inside the hood, and a hint of a face just forward of it - positions/scales
            exactly as provided, no tilt. An upward tilt was tried here to keep this visible from
            the board's own steep (~49° off vertical) camera angle, but it made the flattened
            cavity sphere poke past the hood's own silhouette as a stray fin/petal shape from other
            viewing angles - reported directly, with photos. Untilted, it reads correctly (if more
            subtly) from every angle instead of correctly from one and broken from others. */}
        <mesh position={[0, 2.05, 0.39]} scale={[0.29, 0.37, 0.1]} castShadow>
          <sphereGeometry args={[1, 32, 24]} />
          <primitive object={darkMaterial} attach="material" />
        </mesh>
        <mesh position={[0, 2.05, 0.455]} scale={[0.22, 0.29, 0.06]} castShadow>
          <sphereGeometry args={[1, 32, 24]} />
          <primitive object={mainMaterial} attach="material" />
        </mesh>

        {/* Left arm */}
        <mesh position={[-0.43, 1.18, 0]} rotation={[0, 0, -0.32]} scale={[0.21, 0.55, 0.22]} castShadow>
          <capsuleGeometry args={[1, 1, 8, 16]} />
          <primitive object={mainMaterial} attach="material" />
        </mesh>
        {/* Left hand */}
        <mesh position={[-0.58, 0.88, 0.02]} scale={[0.16, 0.22, 0.16]} castShadow>
          <sphereGeometry args={[1, 24, 16]} />
          <primitive object={mainMaterial} attach="material" />
        </mesh>

        {/* Right arm */}
        <mesh position={[0.43, 1.18, 0]} rotation={[0, 0, 0.32]} scale={[0.21, 0.55, 0.22]} castShadow>
          <capsuleGeometry args={[1, 1, 8, 16]} />
          <primitive object={mainMaterial} attach="material" />
        </mesh>
        {/* Right hand */}
        <mesh position={[0.58, 0.88, 0.02]} scale={[0.16, 0.22, 0.16]} castShadow>
          <sphereGeometry args={[1, 24, 16]} />
          <primitive object={mainMaterial} attach="material" />
        </mesh>

        {/* Front cloth fold */}
        <mesh position={[0, 1.05, 0.43]} scale={[0.1, 0.48, 0.065]} castShadow>
          <sphereGeometry args={[1, 24, 16]} />
          <primitive object={mainMaterial} attach="material" />
        </mesh>
        {/* Left cloth fold */}
        <mesh position={[-0.22, 0.78, 0.4]} rotation={[0, 0, -0.18]} scale={[0.055, 0.5, 0.045]}>
          <sphereGeometry args={[1, 20, 12]} />
          <primitive object={mainMaterial} attach="material" />
        </mesh>
        {/* Right cloth fold */}
        <mesh position={[0.22, 0.78, 0.4]} rotation={[0, 0, 0.18]} scale={[0.055, 0.5, 0.045]}>
          <sphereGeometry args={[1, 20, 12]} />
          <primitive object={mainMaterial} attach="material" />
        </mesh>
      </group>
    </group>
  )
}
