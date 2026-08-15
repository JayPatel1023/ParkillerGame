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

// Body/hood profiles were re-derived directly from Carlos's own dimensioned reference photo
// (parkiller.png, checked in at the repo root - a real product-shot turnaround with a labeled
// 40mm-tall/22mm-wide front elevation), not hand-copied from anyone's code. The back-view
// turntable panel (cleanest silhouette - no face-cavity hole and the near-symmetric pose keeps
// both arms mostly out of frame) was traced pixel-row-by-pixel and converted to normalized
// (radius, height) pairs at this same MODEL_RAW_HEIGHT scale.
//
// Still reported as not matching after that pass - hand-guessing a sculptural profile from a
// static photo, screenshot-then-reason, has hit diminishing returns across several rounds. See
// ParkillerEditor.tsx (#parkiller-editor) for a click-to-trace tool against the same reference
// photo with a live 3D preview, the same fix the board waypoints got once smooth-curve
// approximation stopped being good enough for them either.
//
// Reported directly (in an earlier round, kept for context): scaling by the model's own footprint
// radius (its widest point, matched to PARKILLER_BASE_RADIUS the way a regular pawn's profile is
// matched to its own base radius) put the whole figure at roughly 2.3x a regular pawn's height -
// the model's own proportions are much more slender than a pawn's, so matching the footprint
// overscales the height. Matched to height instead - "clearly bigger than a pawn, not just
// slightly wider" was always about height, not footprint - targeting ~1.4x PieceMesh's own total
// pawn height (0.9116 raw * PROFILE_SCALE * PIECE_HEIGHT_SCALE, see PieceMesh.tsx) over this
// model's own total raw height (hood tip at y=2.9).
const PAWN_HEIGHT = 0.9116 * (0.065 / 0.335) * 1.43
const MODEL_RAW_HEIGHT = 2.9
const MODEL_SCALE = (PAWN_HEIGHT * 1.4) / MODEL_RAW_HEIGHT

const BODY_PROFILE_RAW: [number, number][] = [
  [0.05, 0.0],
  [0.52, 0.04],
  [0.567, 0.15],
  [0.567, 0.9],
  [0.55, 1.3],
  [0.5, 1.55],
  [0.43, 1.75],
  [0.34, 1.9],
  [0.26, 2.0],
]

const HOOD_PROFILE_RAW: [number, number][] = [
  [0.26, 2.0],
  [0.29, 2.11],
  [0.29, 2.22],
  [0.29, 2.32],
  [0.26, 2.43],
  [0.23, 2.53],
  [0.19, 2.64],
  [0.14, 2.74],
  [0.08, 2.85],
  [0.0, 2.9],
]

export interface SphereMeshConfig {
  position: [number, number, number]
  scale: [number, number, number]
}

export interface CapsuleMeshConfig {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
}

export interface ParkillerArmConfig {
  arm: CapsuleMeshConfig
  hand: SphereMeshConfig
}

/** Every number that shapes the model, gathered in one place so ParkillerEditor.tsx (a dev tool,
 * not shipped in the game flow) can drive the exact same geometry live against the reference
 * photo instead of a hand-maintained re-implementation that could quietly drift from what
 * actually ships. */
export interface ParkillerGeometryConfig {
  bodyProfile: [number, number][]
  hoodProfile: [number, number][]
  cavity: SphereMeshConfig
  face: SphereMeshConfig
  arms: [ParkillerArmConfig, ParkillerArmConfig]
  fold: SphereMeshConfig
  modelScale: number
}

export const DEFAULT_PARKILLER_CONFIG: ParkillerGeometryConfig = {
  bodyProfile: BODY_PROFILE_RAW,
  hoodProfile: HOOD_PROFILE_RAW,
  // Dark hollow inside the hood, and a hint of a face just forward of it. No tilt: an upward tilt
  // was tried in an earlier round to keep this visible from the board's own steep (~49° off
  // vertical) camera angle, but it made the flattened cavity sphere poke past the hood's own
  // silhouette as a stray fin/petal shape from other viewing angles - reported directly, with
  // photos.
  cavity: { position: [0, 2.28, 0.4], scale: [0.27, 0.19, 0.1] },
  face: { position: [0, 2.28, 0.47], scale: [0.21, 0.16, 0.07] },
  // Arms are asymmetric in the reference photo, consistently across every angle of its own
  // turnaround sheet, not just a pose quirk of one shot: one arm stays tucked close to the body
  // around chest height, the other hangs all the way down past hip height with a noticeably
  // larger mitten-shaped hand at the end. Kept as-is rather than symmetrized - it's a real,
  // repeated feature of the reference, and an asymmetric silhouette also reads as more distinct
  // from a plain pawn than a mirrored pair would.
  arms: [
    {
      // Right arm - tucked, shorter.
      arm: { position: [0.62, 1.18, 0.05], rotation: [0, 0, 0.3], scale: [0.2, 0.54, 0.22] },
      hand: { position: [0.75, 0.88, 0.08], scale: [0.16, 0.22, 0.16] },
    },
    {
      // Left arm - long, hanging past hip height with a larger mitten.
      arm: { position: [-0.66, 0.95, 0.08], rotation: [0, 0, -0.35], scale: [0.19, 0.75, 0.21] },
      hand: { position: [-0.82, 0.42, 0.15], scale: [0.19, 0.25, 0.19] },
    },
  ],
  fold: { position: [0, 1.1, 0.46], scale: [0.11, 0.55, 0.07] },
  modelScale: MODEL_SCALE,
}

/** Pure geometry/material - no animation, no restPosition offset. Shared by ParkillerMesh (the
 * animated game piece) and ParkillerEditor.tsx (the #parkiller-editor dev tool), so tuning the
 * config in the editor and pasting it back here is guaranteed to reproduce exactly what was
 * tuned, not a close approximation. */
export function ParkillerModel({ color, config }: { color: PieceColor; config: ParkillerGeometryConfig }) {
  const bodyGeometry = useMemo(() => {
    const points = config.bodyProfile.map(([r, y]) => new THREE.Vector2(r, y))
    const geometry = new THREE.LatheGeometry(points, 64)
    geometry.computeVertexNormals()
    return geometry
  }, [config.bodyProfile])

  const hoodGeometry = useMemo(() => {
    const points = config.hoodProfile.map(([r, y]) => new THREE.Vector2(r, y))
    const geometry = new THREE.LatheGeometry(points, 64)
    geometry.computeVertexNormals()
    return geometry
  }, [config.hoodProfile])

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
    <group scale={config.modelScale}>
      {/* Body */}
      <mesh geometry={bodyGeometry} material={mainMaterial} castShadow receiveShadow />

      {/* Pointed hood */}
      <mesh geometry={hoodGeometry} material={mainMaterial} castShadow receiveShadow />

      <mesh position={config.cavity.position} scale={config.cavity.scale} castShadow>
        <sphereGeometry args={[1, 32, 24]} />
        <primitive object={darkMaterial} attach="material" />
      </mesh>
      <mesh position={config.face.position} scale={config.face.scale} castShadow>
        <sphereGeometry args={[1, 32, 24]} />
        <primitive object={mainMaterial} attach="material" />
      </mesh>

      {config.arms.map((armConfig, i) => (
        <group key={i}>
          <mesh position={armConfig.arm.position} rotation={armConfig.arm.rotation} scale={armConfig.arm.scale} castShadow>
            <capsuleGeometry args={[1, 1, 8, 16]} />
            <primitive object={mainMaterial} attach="material" />
          </mesh>
          <mesh position={armConfig.hand.position} scale={armConfig.hand.scale} castShadow>
            <sphereGeometry args={[1, 24, 16]} />
            <primitive object={mainMaterial} attach="material" />
          </mesh>
        </group>
      ))}

      {/* Front cloth fold */}
      <mesh position={config.fold.position} scale={config.fold.scale} castShadow>
        <sphereGeometry args={[1, 24, 16]} />
        <primitive object={mainMaterial} attach="material" />
      </mesh>
    </group>
  )
}

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

  return (
    <group ref={meshRef} position={restPosition}>
      <ParkillerModel color={color} config={DEFAULT_PARKILLER_CONFIG} />
    </group>
  )
}
