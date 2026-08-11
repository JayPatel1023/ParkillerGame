import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Group } from 'three'
import { getColor } from '../core/colorPalette'
import type { PieceColor } from '../core/pieceColor'
import { BASE_HEIGHT } from './boardGeometry'
import {
  BOUNCE_HEIGHT,
  HOP_DURATION,
  INTRO_DURATION,
  INTRO_X_OFFSET,
  INTRO_Y_START,
  MAX_FRAME_DELTA,
  PIECE_BASE_RADIUS,
  PIECE_HEIGHT_SCALE,
  PIECE_PROFILE_RAW,
  PROFILE_SCALE,
  easeOutBounce,
  easeOutCubic,
} from './PieceMesh'

interface ParkillerMeshProps {
  color: PieceColor
  restPosition: [number, number, number]
  /** Set only while this Parkiller is animating its own move; null means "just sit at restPosition". */
  hopFrom: [number, number, number] | null
  hops: [number, number, number][]
  onHopsComplete?: () => void
  introDelay: number
}

// Same lathe-revolved pawn body as PieceMesh (see its own comment for where the profile numbers
// come from), reused wholesale rather than duplicated, plus a small dark hood-tip marker on top so
// it reads as "the Parkiller" for that color at a glance instead of a 5th identical pawn - a full
// sculpted hooded-cloak model (matching the physical piece) was scoped out as extra art work well
// beyond what distinguishing it visually actually requires.
const HOOD_TIP_HEIGHT = 1.035 * PROFILE_SCALE * PIECE_HEIGHT_SCALE // top of the head, in world units
const HOOD_TIP_RADIUS = PIECE_BASE_RADIUS * 0.55

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
    () => PIECE_PROFILE_RAW.map(([r, y]) => new THREE.Vector2(r * PROFILE_SCALE, y * PROFILE_SCALE * PIECE_HEIGHT_SCALE)),
    [],
  )

  return (
    <group ref={meshRef} position={restPosition}>
      <mesh castShadow receiveShadow>
        <latheGeometry args={[profile, 24]} />
        <meshPhysicalMaterial color="#1a1a1a" emissive="#1a1a1a" emissiveIntensity={0.25} roughness={0.3} metalness={0.2} clearcoat={0.6} clearcoatRoughness={0.25} />
      </mesh>
      {/* Small marker in the color it's hunting/protecting, at the hood tip, so it's still readable
          as "belongs to color X" even though the body itself is black. */}
      <mesh position={[0, HOOD_TIP_HEIGHT + HOOD_TIP_RADIUS * 0.6, 0]}>
        <sphereGeometry args={[HOOD_TIP_RADIUS, 12, 12]} />
        <meshStandardMaterial color={getColor(color)} emissive={getColor(color)} emissiveIntensity={0.4} roughness={0.35} />
      </mesh>
    </group>
  )
}
