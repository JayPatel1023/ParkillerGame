import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Group, Mesh } from 'three'
import { getColor } from '../core/colorPalette'
import type { Piece } from '../core/pieces/piece'
import { BASE_HEIGHT } from './boardGeometry'

// Re-traced from a clean reference photo of classic parchís pawns (reported directly: the
// previous silhouette read as bulbous/hourglass-shaped, not a proper cone-and-ball pawn) - the
// previous profile's "waist" narrowed then flared back out almost to the base's own width before
// curving to a point, so the head swelled gradually out of the body instead of sitting as a
// distinct round ball. This one is a clean single taper (base -> neck, hand-placed, a real molded
// plastic base has straighter facets than a smooth curve) topped by a full sphere (neck -> pole,
// a true circular arc - center (0, 0.6766), radius 0.235 - sampled at even angles so it reads as
// round instead of faceted), with the ball's own widest point (its equator, at y=0.6766) narrower
// than the base (0.335 vs 0.335 raw... see PIECE_BASE_RADIUS note) so it reads as a ball sitting
// ON the cone rather than a continuation of it. The first two points are a flat bottom disc (as
// before) so the piece sits flush on the tile instead of balanced on a point.
export const PIECE_PROFILE_RAW: [number, number][] = [
  [0.0, 0.0],
  [0.32, 0.0],
  [0.335, 0.02],
  [0.3, 0.08],
  [0.24, 0.2],
  [0.19, 0.33],
  [0.165, 0.44],
  [0.155, 0.5],
  [0.2035, 0.5591],
  [0.2314, 0.6358],
  [0.235, 0.6766],
  [0.2208, 0.757],
  [0.18, 0.8277],
  [0.1175, 0.8801],
  [0.0608, 0.9036],
  [0.0, 0.9116],
]
export const PIECE_BASE_RADIUS = 0.065
export const PROFILE_SCALE = PIECE_BASE_RADIUS / Math.max(...PIECE_PROFILE_RAW.map(([r]) => r))
// Stretches the profile taller without widening the base - requested directly, twice now ("peones
// más alargados" both times), each time with a reference photo of taller pawns. Applied only to
// the height axis, not PROFILE_SCALE/PIECE_BASE_RADIUS, so the footprint that was measured against
// the real yard holes doesn't change - a piece still sits exactly centered in its slot, just
// stands taller. Bumped again (1.28 -> 1.43) alongside this profile re-trace, since "a bit more
// elongated than the reference photo" was the explicit ask this time.
export const PIECE_HEIGHT_SCALE = 1.43
// Equator of the head ball (y=0.6766 in the raw profile, its widest point) - a second, slightly-
// larger, near-transparent sphere there catches the light as a highlight band, the "glass marble"
// glint real glossy pawns have instead of flat-shaded plastic.
const HIGHLIGHT_Y = 0.6766 * PROFILE_SCALE * PIECE_HEIGHT_SCALE
// Same proportion of the ball's own equator radius (0.235 raw) as before, just carried over to
// the new, narrower ball so the highlight band doesn't end up oversized relative to it.
const HIGHLIGHT_RADIUS = 0.145 * PROFILE_SCALE

// Fixed regardless of how many squares a move covers - a previous version sped up per-hop
// duration for long reward moves so total playback wouldn't drag, but that meant two moves of
// different lengths visibly hopped at different speeds, reported directly as the animation being
// inconsistent ("sometimes smooth, sometimes zips along erratically"). Every hop, on every move,
// now takes exactly this long - a long reward move simply plays for longer in total, which is a
// smaller cost than the animation appearing to change speed depending on the roll.
export const HOP_DURATION = 0.32 // seconds per square hopped - slow enough that each step reads clearly
export const BOUNCE_HEIGHT = 0.24 // world units, how high each hop arcs - a more emphatic, visible bounce

// Caps how much animation time a single frame can advance. Without this, a slow/dropped frame
// (e.g. CPU contention from screen-recording software) can push `delta` past HOP_DURATION in one
// tick, completing an entire hop with no interpolated frame ever rendered - visually the piece
// appears to jump multiple squares at once instead of hopping through them one at a time.
export const MAX_FRAME_DELTA = 1 / 30

export const INTRO_DURATION = 0.55
export const INTRO_X_OFFSET = 6 // starts well off-screen to the right
export const INTRO_Y_START = 5 // and well above the board

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

// Standard easeOutBounce: overshoots past 1 and settles back, giving a "lands and bounces" feel
// when used to drive a position lerp instead of a plain 0..1 fade.
export function easeOutBounce(t: number): number {
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

// Whose-turn cue, take 2 - the first version (a single flat pulsing ring on the ground) was
// reported directly as unsatisfying ("한심하다", not just "make it more visible" like the first
// round of feedback). Replaced entirely rather than re-tuned: a counter-rotating double ring at
// the base (reads as an active energy field, not a static blink) plus a small spinning gold
// marker gem bobbing above the piece's head - a floating indicator is a much more common and
// immediately legible "this is yours, act on it" language in board/mobile games than a ground
// decal alone, and having motion at two different heights (base + overhead) reads as more alive.
const RING_OUTER_SPIN_SPEED = 0.9 // radians/sec
const RING_INNER_SPIN_SPEED = -1.3 // opposite direction from the outer ring, on purpose
const RING_PULSE_SPEED = 1.5
const RING_BASE_OPACITY = 0.55
const RING_PULSE_AMPLITUDE = 0.3

const MARKER_BOB_SPEED = 2.2
const MARKER_BOB_AMPLITUDE = 0.05
const MARKER_SPIN_SPEED = 2.0
const MARKER_BASE_Y = 0.4 // world units above the piece's own base - clears the head with margin
const MARKER_SIZE = 0.024

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
  const indicatorGroupRef = useRef<Group>(null)
  const ringOuterRef = useRef<Mesh>(null)
  const ringInnerRef = useRef<Mesh>(null)
  const markerRef = useRef<Group>(null)
  const indicatorElapsedRef = useRef(0)

  useEffect(() => {
    hopIndexRef.current = 0
    elapsedRef.current = 0
    notifiedRef.current = hops.length === 0
  }, [hops])

  useFrame((_, rawDelta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const delta = Math.min(rawDelta, MAX_FRAME_DELTA)

    if (indicatorGroupRef.current) {
      if (isCurrentTurn) {
        indicatorGroupRef.current.visible = true
        indicatorElapsedRef.current += delta
        const t = indicatorElapsedRef.current

        if (ringOuterRef.current) ringOuterRef.current.rotation.z += delta * RING_OUTER_SPIN_SPEED
        if (ringInnerRef.current) ringInnerRef.current.rotation.z += delta * RING_INNER_SPIN_SPEED
        // Smoothed 0..1..0 rather than a raw sine, so the breathing lingers softly at each extreme
        // instead of moving fastest exactly where it's most visible (a plain sine's own shape).
        const raw = Math.sin(t * RING_PULSE_SPEED) * 0.5 + 0.5
        const pulse = raw * raw * (3 - 2 * raw)
        const ringOpacity = RING_BASE_OPACITY + pulse * RING_PULSE_AMPLITUDE
        if (ringOuterRef.current) (ringOuterRef.current.material as THREE.MeshBasicMaterial).opacity = ringOpacity
        if (ringInnerRef.current) (ringInnerRef.current.material as THREE.MeshBasicMaterial).opacity = ringOpacity

        if (markerRef.current) {
          markerRef.current.position.y = MARKER_BASE_Y + Math.sin(t * MARKER_BOB_SPEED) * MARKER_BOB_AMPLITUDE
          markerRef.current.rotation.y += delta * MARKER_SPIN_SPEED
        }
      } else {
        indicatorGroupRef.current.visible = false
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
          emissiveIntensity={selectable ? 0.55 : isCurrentTurn ? 0.32 : 0.18}
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
      {/* Whose-turn cue: visible on every piece belonging to the current player for their whole
          turn - not just the one(s) selectable right now. */}
      <group ref={indicatorGroupRef} visible={false}>
        {/* Counter-rotating double ring at the base - flat (rotated onto the board plane) and
            unlit (MeshBasicMaterial) so it reads as a glow rather than a lit disc, just outside
            the piece's own footprint so it doesn't hide the base. The outer group applies the
            "lay flat" rotation once; each ring's own rotation.z then spins it within that already-
            flattened plane, independent of the other ring. */}
        <group position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <mesh ref={ringOuterRef}>
            <ringGeometry args={[PIECE_BASE_RADIUS * 1.55, PIECE_BASE_RADIUS * 1.8, 40]} />
            <meshBasicMaterial color="#ffcc00" transparent opacity={RING_BASE_OPACITY} side={THREE.DoubleSide} />
          </mesh>
          <mesh ref={ringInnerRef}>
            {/* Low segment count on purpose - reads as a faceted/angular ring, distinct from the
                smooth outer one, rather than two identical circles just spinning oppositely. */}
            <ringGeometry args={[PIECE_BASE_RADIUS * 2.0, PIECE_BASE_RADIUS * 2.2, 6]} />
            <meshBasicMaterial color="#fff4c2" transparent opacity={RING_BASE_OPACITY} side={THREE.DoubleSide} />
          </mesh>
        </group>
        {/* Floating gem marker above the piece's head - the clearer, more game-familiar "this is
            yours, act on it" cue (bob + spin), on top of the base ring rather than instead of it. */}
        <group ref={markerRef} position={[0, MARKER_BASE_Y, 0]}>
          <mesh>
            <octahedronGeometry args={[MARKER_SIZE, 0]} />
            <meshBasicMaterial color="#ffcc00" transparent opacity={0.9} />
          </mesh>
        </group>
      </group>
    </group>
  )
}
