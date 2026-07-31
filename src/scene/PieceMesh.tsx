import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Group } from 'three'
import { getColor } from '../core/colorPalette'
import type { Piece } from '../core/pieces/piece'
import { BASE_HEIGHT } from './boardGeometry'

// Classic peg-pawn silhouette (flat wide base -> tapered waist/neck -> round ball head) traced
// from a reference pawn photo - a flat bottom disc (the first two points share y=0: the [0,0]
// point sweeps to a single center vertex, [baseR,0] sweeps to a circle, and the lathe connects
// them into a solid cap) rather than a point resting on the board, so it reads as a piece sitting
// ON the tile rather than a cone/teardrop balanced on its tip. Scaled so the base radius lands on
// the same 0.065 world-unit footprint the old cone used (measured against the yard holes).
// Base + waist are hand-placed (a real molded plastic base has straighter facets); the head from
// the waist up is a true circular arc (center (0, 0.70), radius 0.335) sampled at even angles, not
// more hand-picked points - a sphere needs that to read as round instead of faceted at this low a
// vertex count.
const PIECE_PROFILE_RAW: [number, number][] = [
  [0.0, 0.0],
  [0.34, 0.0],
  [0.36, 0.04],
  [0.3, 0.28],
  [0.19, 0.4],
  [0.155, 0.46],
  [0.1683, 0.5],
  [0.2017, 0.54],
  [0.245, 0.58],
  [0.2883, 0.62],
  [0.3217, 0.66],
  [0.3286, 0.7654],
  [0.3095, 0.8282],
  [0.2785, 0.8861],
  [0.2369, 0.9369],
  [0.1861, 0.9785],
  [0.1282, 1.0095],
  [0.0654, 1.0286],
  [0.0, 1.035],
]
const PIECE_BASE_RADIUS = 0.065
const PROFILE_SCALE = PIECE_BASE_RADIUS / Math.max(...PIECE_PROFILE_RAW.map(([r]) => r))
// Equator of the head ball (y=0.70 in the raw profile, its widest point) - a second, slightly-
// larger, near-transparent sphere there catches the light as a highlight band, the "glass marble"
// glint real glossy pawns have instead of flat-shaded plastic.
const HIGHLIGHT_Y = 0.7 * PROFILE_SCALE
const HIGHLIGHT_RADIUS = 0.2 * PROFILE_SCALE

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

// Renders as a small bouncing peg-pawn rather than a flat token: at board scale a flat disc barely
// shows how far it travelled between rolls, but a shape that visibly arcs once per square makes
// the step count countable at a glance.
export function PieceMesh({ piece, restPosition, hopFrom, hops, onHopsComplete, introDelay, selectable, onSelect }: PieceMeshProps) {
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

  // Base radius still matches the measured yard-hole footprint (0.065 world units against a
  // ~0.168 slot diameter - see scripts/generate-waypoints.mjs findYardHoles, run with
  // DEBUG_HOLES=1 to re-measure); only the silhouette itself changed, from a plain cone to this
  // lathe-revolved pawn profile.
  const profile = useMemo(() => PIECE_PROFILE_RAW.map(([r, y]) => new THREE.Vector2(r * PROFILE_SCALE, y * PROFILE_SCALE)), [])

  return (
    <group
      ref={meshRef}
      position={restPosition}
      onClick={(e) => {
        if (!selectable) return
        e.stopPropagation()
        onSelect(piece)
      }}
      scale={selectable ? 1.3 : 1}
    >
      <mesh castShadow receiveShadow>
        <latheGeometry args={[profile, 24]} />
        <meshPhysicalMaterial
          color={getColor(piece.color)}
          emissive={getColor(piece.color)}
          emissiveIntensity={selectable ? 0.55 : 0.18}
          roughness={0.25}
          metalness={0.15}
          clearcoat={0.7}
          clearcoatRoughness={0.2}
        />
      </mesh>
      {/* Glossy highlight band at the head bulb's equator - see HIGHLIGHT_Y/RADIUS comment above. */}
      <mesh position={[0, HIGHLIGHT_Y, 0]}>
        <sphereGeometry args={[HIGHLIGHT_RADIUS, 16, 16]} />
        <meshPhysicalMaterial color="#ffffff" transparent opacity={0.18} roughness={0.15} metalness={0} />
      </mesh>
    </group>
  )
}
