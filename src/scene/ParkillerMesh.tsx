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

// A single lathe revolve (radially symmetric) reads as a round-topped blob, not a hooded figure -
// tried that first, confirmed directly against the reference photo that it didn't read as hooded
// at all. This is a small composite instead: a robe (its own lathe), a separate pointed hood
// (another lathe, sitting on top of the robe rather than blended into one profile, so it can flare
// out wider than the robe's neck before pointing up - the "cowl draped over the shoulders" look in
// the photo), and two arm+hand pieces that break full radial symmetry on purpose, since the
// reference photo's silhouette clearly has visible arms at the sides.
// Reported directly (with reference photos): the Parki figure is clearly bigger than a regular
// pawn, not just slightly wider - 0.075 (vs. a pawn's 0.065 base radius) read as barely different
// once both were on the board. This also scales the hood/robe/arms/hands uniformly since they're
// all derived from this value via ROBE_SCALE below.
const PARKILLER_BASE_RADIUS = 0.1

// Re-measured against a clean, isolated front-on reference shot (no background clutter) - the
// hands come together near the front center (a clasped pose), not out at the sides.
const ROBE_PROFILE_RAW: [number, number][] = [
  [0.0, 0.0],
  [0.42, 0.0],
  [0.44, 0.05],
  [0.36, 0.18],
  [0.29, 0.32],
  [0.24, 0.44],
  [0.22, 0.52],
  [0.21, 0.55],
]
const ROBE_SCALE = PARKILLER_BASE_RADIUS / Math.max(...ROBE_PROFILE_RAW.map(([r]) => r))
const ROBE_TOP_Y = 0.55 * ROBE_SCALE // where the hood sits, in world units

// Reported directly against a clearer multi-color reference photo: the previous hood profile had
// a wide mid-height bulge (0.32 max radius around a third of the way up) that read as round/
// bulbous once lathed - the photo's hood is a much steadier taper, angular/pointed rather than a
// dome, with only a small flare right at the base where it drapes over the shoulders before
// narrowing continuously to the tip.
const HOOD_PROFILE_RAW: [number, number][] = [
  [0.22, 0.0],
  [0.26, 0.045],
  [0.23, 0.13],
  [0.17, 0.22],
  [0.1, 0.3],
  [0.06, 0.36],
  [0.0, 0.38],
]
// Hood uses the same overall scale as the robe (not its own max-radius scale) so the two profiles
// join at a matching radius where the hood sits on the robe's shoulders, instead of a visible seam.
const HOOD_SCALE = ROBE_SCALE

// Re-measured against a sharp, isolated close-up photo (previous references were too small/distant
// to show this): the arm hangs straight down from the shoulder and swings outward, ending in a
// visible hand around hip height - not a pair of hands clasped together at the front, which the
// blurrier reference photos this was tuned against before had misread.
// Reported directly: at the previous ARM_X/ARM_LEAN, the arm stayed inside the robe's own
// silhouette almost its whole length - the robe's radius grows faster toward the base (see
// ROBE_PROFILE_RAW) than a shallow lean angle can outpace, so only the hand cleared the body.
// Starting further out and leaning harder keeps the whole arm visibly separate, not absorbed.
const ARM_LENGTH = 0.38 * ROBE_SCALE // shoulder to hand, including the rounded caps
const ARM_RADIUS = 0.075 * ROBE_SCALE
const ARM_TOP_Y = ROBE_TOP_Y - 0.03 * ROBE_SCALE // just under the hood's hem, at the shoulder
const ARM_X = 0.34 * ROBE_SCALE
const ARM_Z = 0.06 * ROBE_SCALE
const ARM_LEAN = 0.58 // radians the whole arm swings outward from the shoulder
const HAND_RADIUS = 0.085 * ROBE_SCALE

// The hood's hollow interior (the reference photo shows a real carved-out cavity, not a painted
// mark) - a dark, flattened sphere sunk mostly into the hood's own front surface, the same "mostly-
// embedded sphere" trick PieceMesh's glossy highlight band uses. A true concave back-face render
// (a sphere cap rendered inside-out) was tried first but read as a stray fleck from most camera
// angles instead of a hollow - this convex-but-dark, deeply-recessed approach reads more reliably
// as shadow across the board's actual camera angles, even though it isn't literally concave.
const HOOD_CAVITY_RADIUS = 0.19 * ROBE_SCALE
const HOOD_CAVITY_Y = 0.14 * ROBE_SCALE // height within the hood, above its base at ROBE_TOP_Y
const HOOD_CAVITY_Z = 0.1 * ROBE_SCALE // pushed forward so most of the sphere sinks into the hood, only a shallow cap left visible

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

  const robeProfile = useMemo(() => ROBE_PROFILE_RAW.map(([r, y]) => new THREE.Vector2(r * ROBE_SCALE, y * ROBE_SCALE)), [])
  const hoodProfile = useMemo(() => HOOD_PROFILE_RAW.map(([r, y]) => new THREE.Vector2(r * HOOD_SCALE, y * HOOD_SCALE)), [])
  // The hood's hollow is this same piece's own material sitting in shadow, not a separate black
  // part - confirmed directly against the reference photo, which shows no black anywhere on it.
  const cavityColor = useMemo(() => new THREE.Color(getColor(color)).multiplyScalar(0.22), [color])

  const bodyMaterial = (
    <meshPhysicalMaterial
      color={getColor(color)}
      emissive={getColor(color)}
      emissiveIntensity={0.22}
      roughness={0.35}
      metalness={0.1}
      clearcoat={0.5}
      clearcoatRoughness={0.3}
    />
  )

  return (
    <group ref={meshRef} position={restPosition}>
      <mesh castShadow receiveShadow>
        <latheGeometry args={[robeProfile, 24]} />
        {bodyMaterial}
      </mesh>
      <mesh castShadow receiveShadow position={[0, ROBE_TOP_Y, 0]}>
        <latheGeometry args={[hoodProfile, 24]} />
        {bodyMaterial}
      </mesh>
      {/* Shadowed hollow under the hood's point - see HOOD_CAVITY comment above. */}
      <mesh position={[0, ROBE_TOP_Y + HOOD_CAVITY_Y, HOOD_CAVITY_Z]} scale={[1, 1.08, 0.5]}>
        <sphereGeometry args={[HOOD_CAVITY_RADIUS, 20, 14]} />
        <meshStandardMaterial color={cavityColor} roughness={1} metalness={0} />
      </mesh>
      {/* Two arms + hands, breaking full radial symmetry on purpose - the reference photo shows an
          arm hanging from the shoulder and swinging outward, hand visible around hip height, not
          tucked invisibly inside a smooth cloak revolve. */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * ARM_X, ARM_TOP_Y, ARM_Z]} rotation={[0.12, 0, side * ARM_LEAN]}>
          <mesh castShadow position={[0, -ARM_LENGTH / 2, 0]}>
            <capsuleGeometry args={[ARM_RADIUS, Math.max(0.001, ARM_LENGTH - ARM_RADIUS * 2), 4, 8]} />
            {bodyMaterial}
          </mesh>
          <mesh castShadow position={[0, -ARM_LENGTH, 0]}>
            <sphereGeometry args={[HAND_RADIUS, 12, 12]} />
            {bodyMaterial}
          </mesh>
        </group>
      ))}
    </group>
  )
}
