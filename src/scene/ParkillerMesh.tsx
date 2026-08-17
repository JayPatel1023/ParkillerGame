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

// Re-derived directly from a new, far clearer reference the client sent - a proper turnaround
// sheet (front/3-4/side/back, a wireframe pass, a top-down view, and a dimensioned front
// elevation: 40mm tall, 22mm wide at the base) rather than the single angled product photo the
// previous pass worked from. Reported directly, again, that the previous shape ("전혀 클라이언트가
// 원하는 스타일이못된다" - not at all the client's style) read as too narrow for its height and had
// a bulge partway up the hood instead of a clean taper to a point - both visible once actually
// measured against this sheet: the dimensioned elevation's own 22mm/40mm ratio (0.55, i.e. a base
// *radius* of ~0.275x total height) is noticeably wider than this model's old ~0.195 ratio, and
// every one of the sheet's views shows the hood narrowing continuously from shoulder to tip with
// no mid-height bulge at all.
//
// Hand-guessing a sculptural profile from static photos, screenshot-then-reason, has hit
// diminishing returns before - see ParkillerEditor.tsx (#parkiller-editor) for a click-to-trace
// tool against a reference photo with a live 3D preview, the same fix the board waypoints got once
// smooth-curve approximation stopped being good enough for them either.
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

// A continuous bell-like flare from a wide, near-flat base up to narrow shoulders - not the old
// profile's straight vertical-walled cylinder through the midsection, which is nowhere in any of
// the sheet's views. First two points share y=0 (center, then base radius) so the lathe closes
// into a flat bottom disc, the same technique PieceMesh.tsx's own pawn profile uses.
const BODY_PROFILE_RAW: [number, number][] = [
  [0.0, 0.0],
  [0.74, 0.0],
  [0.78, 0.1],
  [0.75, 0.35],
  [0.68, 0.65],
  [0.6, 0.95],
  [0.5, 1.22],
  [0.4, 1.45],
  [0.3, 1.68],
  [0.23, 1.85],
  [0.2, 2.0],
]

// Tapers continuously from the shoulder to a sharp point, matching every view on the sheet - the
// old profile's radius actually *increased* from 0.26 to 0.29 between y=2.0 and y=2.32 before
// tapering, which is exactly the mid-hood bulge reported as wrong.
const HOOD_PROFILE_RAW: [number, number][] = [
  [0.2, 2.0],
  [0.22, 2.05],
  [0.21, 2.15],
  [0.19, 2.3],
  [0.16, 2.45],
  [0.12, 2.6],
  [0.08, 2.72],
  [0.04, 2.82],
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
  // Every view on the new turnaround sheet shows the hood opening as a tall, narrow, rounded
  // oval sitting in the upper half of the hood (not the old wide/shallow archway) - and, just as
  // importantly, completely empty and dark inside, no visible face or color at all. `face` stays
  // in the config (ParkillerEditor.tsx still has a control bound to it) but is rendered dark below
  // instead of removed, so it visually disappears into the cavity rather than showing as a red
  // highlight - reported directly that any visible red inside the hood read as wrong.
  cavity: { position: [0, 2.32, 0.34], scale: [0.17, 0.32, 0.13] },
  face: { position: [0, 2.32, 0.34], scale: [0.12, 0.22, 0.08] },
  // Reported directly, twice now: the clasped-hands-in-front pose read as wrong against the
  // client's reference photo (public/reference/parkiller-full.png, a physical figurine
  // turnaround) - every angle of that photo shows two distinct hands hanging separately at the
  // sides, roughly hip height. The first attempt to fix this guessed the arm's rotation.x/z by
  // eye and landed nowhere near enough to actually point the capsule downward (still ~148-150°
  // off from "hanging down"), which read as short spikes jutting up near the shoulder rather
  // than arms reaching down to the hands - reported back as "looks like a scarecrow". This time
  // the rotation is computed, not guessed: pick a shoulder point (near the body's own surface at
  // shoulder height) and a hand point (at hip height, clearing the body's own flared radius
  // there, ~0.6-0.66 - see BODY_PROFILE_RAW), then derive the exact quaternion/Euler that points
  // the capsule's default +Y axis from one to the other (verified directly against three's own
  // Euler.setFromQuaternion, not hand-derived trig - a 2-angle-only derivation silently drops the
  // rotation.y component whenever the target direction doesn't lie exactly in the X-Z-free plane,
  // which is exactly what produced the wrong-by-150° result above).
  arms: [
    {
      arm: { position: [0.515, 1.12, 0.18], rotation: [0.255, -0.781, -2.537], scale: [0.12, 0.42, 0.14] },
      hand: { position: [0.65, 0.82, 0.24], scale: [0.17, 0.21, 0.17] },
    },
    {
      arm: { position: [-0.515, 1.12, 0.18], rotation: [0.255, 0.781, 2.537], scale: [0.12, 0.42, 0.14] },
      hand: { position: [-0.65, 0.82, 0.24], scale: [0.17, 0.21, 0.17] },
    },
  ],
  fold: { position: [0, 0.75, 0.52], scale: [0.1, 0.5, 0.06] },
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
        <primitive object={darkMaterial} attach="material" />
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
