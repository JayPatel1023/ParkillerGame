import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Group, Mesh } from 'three'
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
// Stretches the profile taller without widening the base - requested directly ("peones más
// alargados", with a reference photo of taller pawns). Applied only to the height axis, not
// PROFILE_SCALE/PIECE_BASE_RADIUS, so the footprint that was measured against the real yard holes
// doesn't change - a piece still sits exactly centered in its slot, just stands taller.
const PIECE_HEIGHT_SCALE = 1.28
// Equator of the head ball (y=0.70 in the raw profile, its widest point) - a second, slightly-
// larger, near-transparent sphere there catches the light as a highlight band, the "glass marble"
// glint real glossy pawns have instead of flat-shaded plastic.
const HIGHLIGHT_Y = 0.7 * PROFILE_SCALE * PIECE_HEIGHT_SCALE
const HIGHLIGHT_RADIUS = 0.2 * PROFILE_SCALE

const HOP_DURATION = 0.32 // seconds per square hopped - slow enough that each step reads clearly
// A reward (PC 5) can move a piece 10-20+ squares in one go - at the standard duration that's
// several continuous seconds of hopping, which reads as broken/stuck rather than as a bonus move
// (reported directly). Longer sequences speed up per-hop so the *total* playback stays capped
// near MAX_TOTAL_ANIMATION_TIME - a normal 1-10 hop dice move is short enough that this never
// kicks in and keeps the full HOP_DURATION per hop; only long reward moves compress, and only
// gradually (a normal move and a huge one sitting right next to each other in hop count used to
// jump straight from 0.32s to near the old 0.09s floor, reported as the animation "suddenly"
// speeding up to an unreadable blur - MIN_HOP_DURATION is now slow enough to still read as
// discrete hops even at the longest legitimate move, and MAX_TOTAL_ANIMATION_TIME raised so the
// speed-up ramps in gradually instead of cliffing at a handful of hops).
const MAX_TOTAL_ANIMATION_TIME = 3.5
const MIN_HOP_DURATION = 0.18 // floor so even the longest reward move still reads as discrete hops, not a blur
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
  /** True for every piece belonging to whoever's turn it is right now - a whose-turn cue, distinct
   * from (and weaker than) `selectable`, which only lights up the specific piece(s) with an actual
   * move available once the dice are rolled. Without this, before rolling there was no visual
   * indication at all of which pieces on the board are even yours this turn. */
  isCurrentTurn: boolean
}

const RING_PULSE_SPEED = 1.5 // radians/sec - slower, gentler "breathing" rather than a mechanical blink
const RING_BASE_OPACITY = 0.16
const RING_PULSE_AMPLITUDE = 0.16
const RING_BASE_SCALE = 1
const RING_PULSE_SCALE_AMPLITUDE = 0.12 // grows/shrinks along with the fade, instead of just the opacity flickering in place

// Renders as a small bouncing peg-pawn rather than a flat token: at board scale a flat disc barely
// shows how far it travelled between rolls, but a shape that visibly arcs once per square makes
// the step count countable at a glance.
export function PieceMesh({
  piece,
  restPosition,
  hopFrom,
  hops,
  onHopsComplete,
  introDelay,
  selectable,
  onSelect,
  isCurrentTurn,
}: PieceMeshProps) {
  const meshRef = useRef<Group>(null)
  const hopIndexRef = useRef(0)
  const elapsedRef = useRef(0)
  const notifiedRef = useRef(true)
  const introRef = useRef({ done: false, elapsed: 0 })
  const ringRef = useRef<Mesh>(null)
  const ringElapsedRef = useRef(0)

  useEffect(() => {
    hopIndexRef.current = 0
    elapsedRef.current = 0
    notifiedRef.current = hops.length === 0
  }, [hops])

  const hopDuration = Math.max(MIN_HOP_DURATION, Math.min(HOP_DURATION, MAX_TOTAL_ANIMATION_TIME / Math.max(1, hops.length)))

  useFrame((_, rawDelta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const delta = Math.min(rawDelta, MAX_FRAME_DELTA)

    if (ringRef.current) {
      if (isCurrentTurn) {
        ringElapsedRef.current += delta
        // Smoothed 0..1..0 rather than a raw sine, so the breathing lingers softly at each extreme
        // instead of moving fastest exactly where it's most visible (a plain sine's own shape).
        const raw = Math.sin(ringElapsedRef.current * RING_PULSE_SPEED) * 0.5 + 0.5
        const pulse = raw * raw * (3 - 2 * raw)
        const material = ringRef.current.material as THREE.MeshBasicMaterial
        material.opacity = RING_BASE_OPACITY + pulse * RING_PULSE_AMPLITUDE
        const scale = RING_BASE_SCALE + pulse * RING_PULSE_SCALE_AMPLITUDE
        ringRef.current.scale.set(scale, scale, 1)
        ringRef.current.visible = true
      } else {
        ringRef.current.visible = false
      }
    }

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
    const t = Math.min(1, elapsedRef.current / hopDuration)
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
  const profile = useMemo(
    () => PIECE_PROFILE_RAW.map(([r, y]) => new THREE.Vector2(r * PROFILE_SCALE, y * PROFILE_SCALE * PIECE_HEIGHT_SCALE)),
    [],
  )

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
      {/* Whose-turn cue: a soft pulsing ring at the base, visible on every piece belonging to the
          current player for their whole turn - not just the one(s) selectable right now. Flat
          (rotated onto the board plane) and unlit (MeshBasicMaterial) so it reads as a glow rather
          than a lit disc, and just outside the piece's own footprint so it doesn't hide the base. */}
      <mesh ref={ringRef} position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[PIECE_BASE_RADIUS * 1.6, PIECE_BASE_RADIUS * 1.95, 40]} />
        <meshBasicMaterial color="#fff4c2" transparent opacity={RING_BASE_OPACITY} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}
