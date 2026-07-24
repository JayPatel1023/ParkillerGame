import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Mesh } from 'three'
import { getColor } from '../core/colorPalette'
import type { Piece } from '../core/pieces/piece'
import { BASE_HEIGHT } from './boardGeometry'

const HOP_DURATION = 0.32 // seconds per square hopped - slow enough that each step reads clearly
const BOUNCE_HEIGHT = 0.24 // world units, how high each hop arcs - a more emphatic, visible bounce

// Caps how much animation time a single frame can advance. Without this, a slow/dropped frame
// (e.g. CPU contention from screen-recording software) can push `delta` past HOP_DURATION in one
// tick, completing an entire hop with no interpolated frame ever rendered - visually the piece
// appears to jump multiple squares at once instead of hopping through them one at a time.
const MAX_FRAME_DELTA = 1 / 30

const INTRO_DURATION = 0.55
const INTRO_X_OFFSET = 6 // starts well off-screen to the right
const INTRO_Y_START = 5 // and well above the board

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

// Standard easeOutBounce: overshoots past 1 and settles back, giving a "lands and bounces" feel
// when used to drive a position lerp instead of a plain 0..1 fade.
function easeOutBounce(t: number): number {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) {
    const t2 = t - 1.5 / d1
    return n1 * t2 * t2 + 0.75
  }
  if (t < 2.5 / d1) {
    const t2 = t - 2.25 / d1
    return n1 * t2 * t2 + 0.9375
  }
  const t2 = t - 2.625 / d1
  return n1 * t2 * t2 + 0.984375
}

interface PieceMeshProps {
  piece: Piece
  restPosition: [number, number, number]
  /** Set only for the one piece currently animating a move; null means "just sit at restPosition". */
  hopFrom: [number, number, number] | null
  hops: [number, number, number][]
  onHopsComplete?: () => void
  /** Seconds to wait before this piece's one-time drop-in-and-bounce entrance plays, for a staggered cascade. */
  introDelay: number
  selectable: boolean
  onSelect: (piece: Piece) => void
}

// Renders as a small bouncing cone (pawn-like) rather than a flat token: at board scale a flat
// disc barely shows how far it travelled between rolls, but a shape that visibly arcs once per
// square makes the step count countable at a glance.
export function PieceMesh({ piece, restPosition, hopFrom, hops, onHopsComplete, introDelay, selectable, onSelect }: PieceMeshProps) {
  const meshRef = useRef<Mesh>(null)
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

  return (
    <mesh
      ref={meshRef}
      position={restPosition}
      castShadow
      onClick={(e) => {
        if (!selectable) return
        e.stopPropagation()
        onSelect(piece)
      }}
      scale={selectable ? 1.3 : 1}
    >
      {/* Radius/height sized to ~77% of the measured average yard-slot diameter across all
          boards (0.065 world-unit radius against a ~0.168 slot diameter) - see
          scripts/generate-waypoints.mjs findYardHoles, run with DEBUG_HOLES=1 to re-measure. */}
      <coneGeometry args={[0.065, 0.14, 24]} />
      <meshStandardMaterial
        color={getColor(piece.color)}
        emissive={selectable ? getColor(piece.color) : '#000000'}
        emissiveIntensity={selectable ? 0.5 : 0}
      />
    </mesh>
  )
}
