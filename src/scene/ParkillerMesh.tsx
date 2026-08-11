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

// Hooded-cloak silhouette (wide hem -> tapering robe -> narrow neck -> hood flaring back out ->
// pointed tip), traced from the reference physical piece photo - a deliberately different profile
// from PieceMesh's round-headed pawn (not just a recolor) so the Parkiller reads as its own token
// type at a glance, same as the real set does. Still a lathe revolve (radially symmetric), which
// can't capture the reference photo's clasped-hands/asymmetric front detail without hand-authored
// non-lathe geometry - the hood + robe silhouette alone is what's scoped for now.
const PARKILLER_PROFILE_RAW: [number, number][] = [
  [0.0, 0.0],
  [0.38, 0.0],
  [0.4, 0.05],
  [0.34, 0.22],
  [0.27, 0.38],
  [0.21, 0.5],
  [0.195, 0.58],
  [0.22, 0.63],
  [0.3, 0.68],
  [0.31, 0.76],
  [0.27, 0.86],
  [0.19, 0.95],
  [0.1, 1.02],
  [0.0, 1.06],
]
const PARKILLER_BASE_RADIUS = 0.07 // slightly wider stance than a regular pawn's 0.065, per the reference photo
const PARKILLER_PROFILE_SCALE = PARKILLER_BASE_RADIUS / Math.max(...PARKILLER_PROFILE_RAW.map(([r]) => r))

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

  const profile = useMemo(
    () => PARKILLER_PROFILE_RAW.map(([r, y]) => new THREE.Vector2(r * PARKILLER_PROFILE_SCALE, y * PARKILLER_PROFILE_SCALE)),
    [],
  )

  return (
    <group ref={meshRef} position={restPosition}>
      <mesh castShadow receiveShadow>
        <latheGeometry args={[profile, 24]} />
        <meshPhysicalMaterial
          color={getColor(color)}
          emissive={getColor(color)}
          emissiveIntensity={0.22}
          roughness={0.35}
          metalness={0.1}
          clearcoat={0.5}
          clearcoatRoughness={0.3}
        />
      </mesh>
      {/* Shadowed hollow under the hood's brim, like the reference photo's recessed face - a small
          dark disc just under the flare-out point rather than fully sculpting an opening. */}
      <mesh position={[0, 0.63 * PARKILLER_PROFILE_SCALE, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.2 * PARKILLER_PROFILE_SCALE, 16]} />
        <meshBasicMaterial color="#0a0a0a" />
      </mesh>
    </group>
  )
}
