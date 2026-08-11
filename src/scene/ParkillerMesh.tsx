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
  /** Set only while this Parkiller is animating its own move; null means "just sit at restPosition". */
  hopFrom: [number, number, number] | null
  hops: [number, number, number][]
  onHopsComplete?: () => void
  introDelay: number
}

// A single lathe revolve (radially symmetric) reads as a round-topped blob, not a hooded figure -
// tried that first, confirmed directly against the reference photo that it didn't read as hooded
// at all. This is a small composite instead: a robe (its own lathe), a separate pointed hood
// (another lathe, sitting on top of the robe rather than blended into one profile, so it can flare
// out wider than the robe's neck before pointing up - the "cowl draped over the shoulders" look in
// the photo), and two arm+hand pieces that break full radial symmetry on purpose, since the
// reference photo's silhouette clearly has visible arms at the sides.
const PARKILLER_BASE_RADIUS = 0.075 // slightly wider stance than a regular pawn's 0.065, per the reference photo

const ROBE_PROFILE_RAW: [number, number][] = [
  [0.0, 0.0],
  [0.4, 0.0],
  [0.42, 0.05],
  [0.36, 0.18],
  [0.3, 0.32],
  [0.24, 0.44],
  [0.21, 0.52],
  [0.2, 0.55],
]
const ROBE_SCALE = PARKILLER_BASE_RADIUS / Math.max(...ROBE_PROFILE_RAW.map(([r]) => r))
const ROBE_TOP_Y = 0.55 * ROBE_SCALE // where the hood sits, in world units

const HOOD_PROFILE_RAW: [number, number][] = [
  [0.2, 0.0],
  [0.27, 0.04],
  [0.29, 0.1],
  [0.26, 0.2],
  [0.19, 0.32],
  [0.1, 0.4],
  [0.0, 0.46],
]
// Hood uses the same overall scale as the robe (not its own max-radius scale) so the two profiles
// join at a matching radius where the hood sits on the robe's shoulders, instead of a visible seam.
const HOOD_SCALE = ROBE_SCALE

const ARM_Y = 0.32 * ROBE_SCALE // roughly mid-robe height
const ARM_X = 0.27 * ROBE_SCALE
const ARM_Z = 0.06 * ROBE_SCALE
const HAND_Y = 0.16 * ROBE_SCALE
const HAND_X = 0.2 * ROBE_SCALE
const HAND_Z = 0.12 * ROBE_SCALE // hands sit further forward than the arms, like the photo's clasped pose

export function ParkillerMesh({ color, restPosition, hopFrom, hops, onHopsComplete, introDelay }: ParkillerMeshProps) {
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
      {/* Shadowed hollow under the hood's brim, like the reference photo's recessed face - a small
          dark disc rather than fully sculpting an opening. */}
      <mesh position={[0, ROBE_TOP_Y + 0.08 * ROBE_SCALE, ARM_Z * 1.6]} rotation={[-Math.PI / 3, 0, 0]}>
        <circleGeometry args={[0.16 * ROBE_SCALE, 16]} />
        <meshBasicMaterial color="#0a0a0a" />
      </mesh>
      {/* Two arms + hands, breaking full radial symmetry on purpose - the reference photo's
          silhouette clearly shows both, hanging at the sides and meeting slightly forward near the
          waist, not tucked invisibly inside a smooth cloak revolve. */}
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh castShadow position={[side * ARM_X, ARM_Y, ARM_Z]} rotation={[0.15, 0, side * 0.25]} scale={[0.85, 1.8, 0.85]}>
            <sphereGeometry args={[0.09 * ROBE_SCALE, 12, 12]} />
            {bodyMaterial}
          </mesh>
          <mesh castShadow position={[side * HAND_X, HAND_Y, HAND_Z]} scale={[1, 0.85, 1]}>
            <sphereGeometry args={[0.085 * ROBE_SCALE, 12, 12]} />
            {bodyMaterial}
          </mesh>
        </group>
      ))}
    </group>
  )
}
