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
// Grown alongside BOARD_SIZE (boardGeometry.ts, 10 -> 12): reported directly that pieces read as
// too small against the now-bigger board/tiles. Scaled by the same ~1.2x BOARD_SIZE grew by, so
// the piece-to-tile ratio (and the zero-overlap crowding fit that ratio depends on) stays exactly
// what it was, not the yard-hole footprint match this was originally calibrated against alone.
//
// Bumped again, 0.078 -> 0.1, alongside BOARD_SIZE's own 12 -> 17: reported directly, again, with
// a screenshot of a single yard piece dwarfed by its own yard-hole artwork - still too small.
//
// Bumped a fourth time, 0.1 -> 0.108, alongside BOARD_SIZE's own 17 -> 18 - reported directly,
// again, as still too small.
//
// Bumped a fifth time, 0.108 -> 0.12, alongside BOARD_SIZE's own 18 -> 20 - reported directly,
// again, as still too small.
//
// Bumped a sixth time, 0.12 -> 0.13, alongside BOARD_SIZE's own 22 -> 24 - reported directly,
// again, as still too small.
//
// Bumped a seventh time, 0.13 -> 0.15, alongside BOARD_SIZE's own 24 -> 28 - reported directly,
// again, as still too small. A bigger jump than the previous six rounds' own ~8-10% increments,
// since six consecutive "still too small" reports in a row means those smaller steps clearly
// weren't closing the gap fast enough.
//
// Bumped an eighth time, 0.15 -> 0.17, alongside BOARD_SIZE's own 28 -> 32 - reported directly,
// again, as still too small.
//
// Bumped a ninth time, 0.17 -> 0.22, alongside BOARD_SIZE's own 32 -> 41 - reported directly,
// again, as too small to make out. A bigger jump than most previous rounds: the board's own
// on-screen size also just got genuinely smaller for the first time (the OrbitControls/far-plane
// bug that had been silently blocking every earlier "shrink the board" request - see
// CAMERA_DISTANCE's own comment - is now actually fixed), which on its own makes every piece read
// smaller on screen even without this change, on top of the standalone "still too small" report.
//
// Bumped a tenth time, 0.22 -> 0.28 - reported directly, again, as still too small. Nine
// consecutive "still too small" reports in a row (matching the seventh round's own reasoning for
// its bigger-than-usual step) calls for a decisively larger jump rather than another small nudge -
// checked directly against the tightest (6-player) board's own measured tile size (~1.478, so
// radius ~0.739) first: even at 0.28 a single piece still occupies well under half that tile
// radius, and the existing stacking clamp (BoardScene.tsx's own localStackOffset/MAX_OCCUPANT_RADIUS)
// scales with this constant automatically, so two pieces sharing a square still can't spill past
// their tile's own border regardless of how large this gets.
export const PIECE_BASE_RADIUS = 0.28
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

// This piece's own total height in world units (the raw profile's own top point, 0.9116, scaled
// the same way the rendered geometry itself is) - used below for the movable-cue marker's own
// height offset, so it stays correctly positioned above the head regardless of how big
// PIECE_BASE_RADIUS is currently set to, instead of a fixed guess that only matched one specific
// size. Also usable by ParkillerMesh.tsx (imports PIECE_PROFILE_RAW/PROFILE_SCALE/PIECE_HEIGHT_SCALE
// from here already for the exact same reason - its own PAWN_HEIGHT constant duplicates this
// formula rather than importing it directly, kept as-is to avoid an unrelated refactor here).
const PAWN_TOTAL_HEIGHT = PIECE_PROFILE_RAW[PIECE_PROFILE_RAW.length - 1][1] * PROFILE_SCALE * PIECE_HEIGHT_SCALE

// Fixed regardless of how many squares a move covers - a previous version sped up per-hop
// duration for long reward moves so total playback wouldn't drag, but that meant two moves of
// different lengths visibly hopped at different speeds, reported directly as the animation being
// inconsistent ("sometimes smooth, sometimes zips along erratically"). Every hop, on every move,
// now takes exactly this long - a long reward move simply plays for longer in total, which is a
// smaller cost than the animation appearing to change speed depending on the roll.
export const HOP_DURATION = 0.32 // seconds per square hopped - slow enough that each step reads clearly
export const BOUNCE_HEIGHT = 0.24 // world units, how high each hop arcs - a more emphatic, visible bounce

// Reported directly ("말이 이동할때 통통뛰게 해달라" - make the piece bounce springily when it
// moves): the existing hop was a plain sine arc - smooth up, smooth down, the piece's own shape
// never changing - which reads as gliding/floating rather than a genuine springy hop. Classic
// squash-and-stretch is what actually reads as "bouncy".
//
// First pass tied both squash and stretch directly to `bounce`/BOUNCE_HEIGHT (height above ground),
// so the piece was maximally *stretched* exactly at the arc's apex - the one instant it's moving
// slowest (vertical velocity is zero right at the peak). Reported directly as looking "흐물쩍"
// (floppy/rubbery) instead of springy: a real bounce stretches while moving fast (just after
// launch, just before landing) and squashes only in a brief instant at contact, not smoothly
// ballooning taller for the whole time it hangs near the top. Height-based timing put the biggest
// deformation exactly where a real object is closest to its resting shape, which reads as slow
// melting rather than a snap.
//
// Rebuilt on elapsed time `t` (0..1 across the hop) instead of height, as two blended pulses: a
// sharp `contactPulse` that's 1 exactly at t=0/1 (ground contact) and decays to 0 within
// HOP_SQUASH_WINDOW, giving a brief, snappy squash right at each landing/takeoff; and a gentler
// `stretchPulse` (plain sin(t*pi), suppressed by (1-contactPulse) so it never fights the squash
// window) that peaks at t=0.5 - a mild stretch through the fast-moving middle of the arc that's
// already fading in as the squash window ends, rather than a separate, disconnected bulge only at
// the very top.
//
// Magnitudes pulled in on the first pass here (to 0.85/1.1/1.1/0.95, down from an even earlier
// 0.8/1.22/1.14/0.92) alongside that timing fix - reported directly afterward as reading "딱딱하고
// 굳은것처럼" (stiff/rigid) instead of springy. The floppy complaint that motivated the timing
// rewrite was about *when* the deformation happened (stretching at the apex, the one instant a
// real object is moving slowest), not really about how big it was - now that squash is genuinely
// confined to the brief contact window and stretch to the fast-moving middle, a bigger swing reads
// as a energetic bounce rather than a melt, so pushed back out again, slightly past the original
// pre-timing-fix numbers this time given the explicit "still too stiff" feedback.
const HOP_SQUASH_WINDOW = 0.2 // fraction of the hop, from each end, where the contact squash dominates - narrowed slightly so the squash itself reads as a snap, not a lingering squat
const HOP_SQUASH_Y = 0.76 // compressed height at each square (ground contact)
const HOP_STRETCH_Y = 1.24 // stretched height through the arc's fast-moving middle
const HOP_SQUASH_XZ = 1.18 // widened footprint at each square, complementing the Y squash
const HOP_STRETCH_XZ = 0.88 // narrowed footprint through the arc's middle, complementing the Y stretch

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

// Overshoots past 1 then settles back to exactly 1 - used for the "just became movable" pop so it
// reads as a snap/flourish rather than a linear grow.
export function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
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
  /** True for every piece belonging to whoever's turn it is right now - kept deliberately plain (a
   * faint emissive tint only, see the material below) so it doesn't compete with `selectable`,
   * which is the piece(s) with an actual move available once the dice are rolled and carries the
   * animated ring/marker/flash below. Without `isCurrentTurn` at all, before rolling there was no
   * visual indication of which pieces on the board are even yours this turn. */
  isCurrentTurn: boolean
  /** Reported directly ("봇이게임할때 말을 이동할차례가되여서 이동시킬때에도 자기 차례를 알리는 효과를
   * 넣어달라" - add the same turn-announcing effect for bot moves too): `selectable` only ever
   * lights up for a human's own choosable pieces (see GameBoardScreen's own visiblePendingMoves,
   * gated on isMyTurn - always empty during a bot's turn), so a bot's move used to just start
   * hopping with zero anticipatory cue at all, unlike a human's own deliberate click. This carries
   * the exact same ring/glow/beam/flash indicator below for the one piece a bot has just decided
   * to move, without making it clickable - `onClick` below stays gated on `selectable` alone. */
  highlighted?: boolean
  /** BoardScene's own CROWDED_SCALE (< 1) whenever this piece shares its square with another
   * occupant, 1 otherwise - see that constant's own comment for why. Multiplied into the same
   * scale the selectable/idle animation already drives, not a separate transform, so a crowded
   * piece still pops on selection the same way an uncrowded one does, just smaller throughout. */
  crowdedScale?: number
}

// Movable cue, keyed off `selectable` (not `isCurrentTurn` - see the prop doc above): a
// counter-rotating double ring at the base plus a small spinning gold marker gem bobbing above the
// piece's head. Kept off pieces that are merely "yours this turn" so the animated effect stays a
// reliable "you can act on this one" signal instead of lighting up on every piece for the whole turn.
//
// Reported directly ("자기차례가 되여서 말을 이동할수있는말들을 시각적으로 알리게 효과를달라" - add a
// visual effect showing which pieces can be moved on your turn): this cue already existed, but
// verified live it was reading as essentially invisible - MARKER_BASE_Y/MARKER_SIZE were both
// fixed absolute world-unit constants dating back to PIECE_BASE_RADIUS's very first value (0.065),
// never updated across nine rounds of piece growth since (now 0.22, a ~3.4x increase). The marker
// gem's old fixed height (0.4) ended up roughly mid-body on the current pawn instead of "above the
// head with margin" as originally intended - confirmed directly via a zoomed screenshot, no marker
// visible at all, buried inside the piece's own geometry. Both now derive from the pawn's own
// actual current height/radius instead of a stale absolute guess, so they stay correctly
// proportioned through any future size change. Ring opacity also bumped for better contrast -
// the previous value read as a faint, easy-to-miss outline once actually checked at real board
// scale, not the "faceted, and unlit is fine because Colors are Correct" it looked like in the
// numbers alone.
// Reported directly, again ("말이 이동할 차례가 되였을 때 효과를 잘알리게해달라" - make the effect
// clearly noticeable when a piece can move): a live screenshot of the yard showed the cue was
// there and animating correctly, but essentially camouflaged - both rings and the marker were gold
// (#ffcc00/#fff4c2), sitting directly on top of the yard slot's own gold decorative ring artwork,
// so the "you can act on this one" ring blended straight into board art that looks the same
// whether or not a piece is selectable. Rebuilt for actual contrast against ANY background instead
// of just more of the same gold: a dark navy outline ring sits behind the bright rings (reads
// against light board art AND against another piece's own bright color alike, the way text gets a
// dark stroke for legibility over a busy image), a soft white-hot glow disc underneath (same
// "reads before the eye resolves the ring itself" trick BarrierIndicator's own fix used), and a
// thin vertical light beam rising from the piece through the marker - a "spotlight on this exact
// piece" language nothing else on this board uses, so it can't be mistaken for decoration.
const GLOW_COLOR = '#fff6d8'
const OUTLINE_COLOR = '#1a2a4a'
const RING_OUTER_SPIN_SPEED = 0.9 // radians/sec
const RING_INNER_SPIN_SPEED = -1.3 // opposite direction from the outer ring, on purpose
const RING_PULSE_SPEED = 1.5
const RING_BASE_OPACITY = 0.95
const RING_PULSE_AMPLITUDE = 0.15
const GLOW_BASE_OPACITY = 0.35
const GLOW_PULSE_AMPLITUDE = 0.15
const BEAM_BASE_OPACITY = 0.4
const BEAM_PULSE_AMPLITUDE = 0.2

const MARKER_BOB_SPEED = 2.2
const MARKER_BOB_AMPLITUDE = 0.05
const MARKER_SPIN_SPEED = 2.0
// PAWN_TOTAL_HEIGHT (below, near the profile constants) * 1.3 - comfortably clears the head with
// real margin, scaling correctly with piece size instead of a fixed guess.
const MARKER_BASE_Y = PAWN_TOTAL_HEIGHT * 1.3
const MARKER_SIZE = PIECE_BASE_RADIUS * 0.55

const IDLE_SCALE = 1
const SELECTABLE_SCALE = 1.3
const SELECTABLE_EMISSIVE = 0.55
const TURN_EMISSIVE = 0.32
const IDLE_EMISSIVE = 0.18

// The moment a piece becomes selectable, it pops in (scale overshoots via easeOutBack) and briefly
// flashes brighter/bigger rings before settling to the steady selectable state above - a distinct,
// eye-catching "this just became movable" beat instead of the same static look simply appearing.
const FLASH_DURATION = 0.35 // seconds
const FLASH_EMISSIVE_BOOST = 0.45
const FLASH_RING_SCALE_BOOST = 0.6

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
  highlighted = false,
  crowdedScale = 1,
}: PieceMeshProps) {
  const meshRef = useRef<Group>(null)
  const hopIndexRef = useRef(0)
  const elapsedRef = useRef(0)
  const notifiedRef = useRef(true)
  const introRef = useRef({ done: false, elapsed: 0 })
  const indicatorGroupRef = useRef<Group>(null)
  const ringOuterRef = useRef<Mesh>(null)
  const ringInnerRef = useRef<Mesh>(null)
  const glowRef = useRef<Mesh>(null)
  const beamRef = useRef<Mesh>(null)
  const markerRef = useRef<Group>(null)
  const indicatorElapsedRef = useRef(0)
  const bodyMaterialRef = useRef<THREE.MeshPhysicalMaterial>(null)
  const prevSelectableRef = useRef(false)
  const flashElapsedRef = useRef(0)

  // See ParkillerMesh's own matching comment - keyed off hopFrom (BoardScene's own "an animation
  // was actually requested" signal), not hops.length alone, so a real but zero-hop update (none
  // occur for a regular piece today, but this mirrors ParkillerMesh defensively rather than leaving
  // an identical latent trap for whenever one does) still fires onHopsComplete exactly once instead
  // of never.
  useEffect(() => {
    hopIndexRef.current = 0
    elapsedRef.current = 0
    notifiedRef.current = hopFrom === null
  }, [hops, hopFrom])

  useFrame((_, rawDelta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const delta = Math.min(rawDelta, MAX_FRAME_DELTA)

    // Drives the same ring/glow/beam/flash indicator for either a human's own choosable piece or a
    // bot's just-decided one (see `highlighted`'s own doc comment) - `onClick` below stays gated on
    // `selectable` alone, so a bot's highlighted piece still isn't clickable.
    const showIndicator = selectable || highlighted

    // Detect the false -> true transition to restart the flash from its beginning each time a
    // piece newly becomes selectable/highlighted, rather than only once ever.
    if (showIndicator && !prevSelectableRef.current) flashElapsedRef.current = 0
    if (showIndicator) flashElapsedRef.current += delta
    prevSelectableRef.current = showIndicator

    const flashT = Math.min(1, flashElapsedRef.current / FLASH_DURATION)
    // Eased decay from 1 (the instant it becomes selectable) to 0 (steady state) - drives the
    // brightness/ring-size flash. Scale itself uses easeOutBack directly below for the pop-overshoot.
    const flashFade = showIndicator ? 1 - easeOutCubic(flashT) : 0

    const uniformScale = crowdedScale * (showIndicator ? THREE.MathUtils.lerp(IDLE_SCALE, SELECTABLE_SCALE, easeOutBack(flashT)) : IDLE_SCALE)
    mesh.scale.setScalar(uniformScale)
    if (bodyMaterialRef.current) {
      const steadyEmissive = showIndicator ? SELECTABLE_EMISSIVE : isCurrentTurn ? TURN_EMISSIVE : IDLE_EMISSIVE
      bodyMaterialRef.current.emissiveIntensity = steadyEmissive + flashFade * FLASH_EMISSIVE_BOOST
    }

    if (indicatorGroupRef.current) {
      if (showIndicator) {
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
        const ringScale = 1 + flashFade * FLASH_RING_SCALE_BOOST
        if (ringOuterRef.current) {
          ;(ringOuterRef.current.material as THREE.MeshBasicMaterial).opacity = ringOpacity
          ringOuterRef.current.scale.setScalar(ringScale)
        }
        if (ringInnerRef.current) {
          ;(ringInnerRef.current.material as THREE.MeshBasicMaterial).opacity = ringOpacity
          ringInnerRef.current.scale.setScalar(ringScale)
        }
        if (glowRef.current) {
          const glowMat = glowRef.current.material as THREE.MeshBasicMaterial
          glowMat.opacity = GLOW_BASE_OPACITY + pulse * GLOW_PULSE_AMPLITUDE + flashFade * 0.3
          const glowScale = 1 + flashFade * FLASH_RING_SCALE_BOOST
          glowRef.current.scale.set(glowScale, glowScale, 1)
        }
        if (beamRef.current) {
          ;(beamRef.current.material as THREE.MeshBasicMaterial).opacity = BEAM_BASE_OPACITY + pulse * BEAM_PULSE_AMPLITUDE
        }

        if (markerRef.current) {
          markerRef.current.position.y = MARKER_BASE_Y + Math.sin(t * MARKER_BOB_SPEED) * MARKER_BOB_AMPLITUDE
          markerRef.current.rotation.y += delta * MARKER_SPIN_SPEED
        }
      } else {
        indicatorGroupRef.current.visible = false
        indicatorElapsedRef.current = 0
      }
    }

    // Same clamped-delta bug as the hop-stepping loop below used to have (see its own comment) -
    // this timer used the clamped `delta`, so a slow/dropped frame anywhere during the intro
    // under-counts real elapsed time and delays introRef.current.done becoming true, which gates
    // onHopsComplete below it - reported directly as a piece never becoming movable with a second
    // die after an unrelated first move (ParkillerMesh.tsx had the identical bug, confirmed live by
    // instrumenting its own useFrame). Uses the real, unclamped rawDelta instead, same fix.
    if (!introRef.current.done) {
      introRef.current.elapsed += rawDelta
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

    // Reported directly ("이따금 비루스먹은것처럼 섯다움직이는" - occasionally stutters/freezes like
    // something's glitching): a slow/dropped real frame (a GC pause, tab throttling, background
    // contention) used to have its own elapsed time clamped down to MAX_FRAME_DELTA before
    // advancing the hop's own clock - so a frame that actually took, say, 300ms only advanced the
    // hop's animated time by 33ms, and the piece visibly sat almost still for that stretch (a real
    // freeze), then resumed at the normal rate afterward, playing out slower in total than
    // HOP_DURATION actually calls for. Uses the real, unclamped rawDelta here instead, looping
    // through as many hop segments as that much real time actually covers - a long stall spanning
    // more than one hop's worth of real time still catches up to exactly where the piece truly
    // should be, never frozen mid-air. The clamped `delta` above stays for the purely cosmetic
    // pulse/spin timers elsewhere in this file, where losing a few ms during a rare stall is
    // genuinely unnoticeable, unlike a hop's own position.
    let remainingDelta = rawDelta
    while (remainingDelta > 0 && hopIndexRef.current < hops.length) {
      elapsedRef.current += remainingDelta
      const t = Math.min(1, elapsedRef.current / HOP_DURATION)
      const from = hopIndexRef.current === 0 ? hopFrom : hops[hopIndexRef.current - 1]
      const to = hops[hopIndexRef.current]

      const x = THREE.MathUtils.lerp(from[0], to[0], t)
      const z = THREE.MathUtils.lerp(from[2], to[2], t)
      const bounce = Math.sin(t * Math.PI) * BOUNCE_HEIGHT
      mesh.position.set(x, BASE_HEIGHT + bounce, z)

      // See HOP_SQUASH_WINDOW's own comment: contactPulse is a brief spike at t=0/1 (squash right
      // at landing/takeoff), stretchPulse is a gentler sin(t*pi) bump through the middle,
      // suppressed near the edges so the two blend smoothly instead of fighting or jump-cutting.
      const edgeDistance = Math.min(t, 1 - t)
      const contactPulse = Math.max(0, 1 - edgeDistance / HOP_SQUASH_WINDOW)
      const stretchPulse = Math.sin(t * Math.PI) * (1 - contactPulse)
      const squashStretchY = 1 + (HOP_SQUASH_Y - 1) * contactPulse + (HOP_STRETCH_Y - 1) * stretchPulse
      const squashStretchXZ = 1 + (HOP_SQUASH_XZ - 1) * contactPulse + (HOP_STRETCH_XZ - 1) * stretchPulse
      mesh.scale.set(uniformScale * squashStretchXZ, uniformScale * squashStretchY, uniformScale * squashStretchXZ)

      if (t >= 1) {
        remainingDelta = elapsedRef.current - HOP_DURATION
        hopIndexRef.current += 1
        elapsedRef.current = 0
      } else {
        remainingDelta = 0
      }
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
    >
      <mesh castShadow receiveShadow>
        <latheGeometry args={[profile, 24]} />
        <meshPhysicalMaterial
          ref={bodyMaterialRef}
          color={getColor(piece.color)}
          emissive={getColor(piece.color)}
          emissiveIntensity={IDLE_EMISSIVE}
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
      {/* Movable cue: visible only on the piece(s) with an actual legal move this roll - not on
          every piece belonging to the current player for the whole turn. */}
      <group ref={indicatorGroupRef} visible={false}>
        {/* Counter-rotating double ring at the base - flat (rotated onto the board plane) and
            unlit (MeshBasicMaterial) so it reads as a glow rather than a lit disc, just outside
            the piece's own footprint so it doesn't hide the base. The outer group applies the
            "lay flat" rotation once; each ring's own rotation.z then spins it within that already-
            flattened plane, independent of the other ring. */}
        <group position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          {/* Soft glow disc under everything else - reads at a glance from across the board, before
              the eye even resolves the ring's own thin geometry (same trick BarrierIndicator uses). */}
          <mesh ref={glowRef} position={[0, 0, -0.001]}>
            <circleGeometry args={[PIECE_BASE_RADIUS * 2.6, 32]} />
            <meshBasicMaterial color={GLOW_COLOR} transparent opacity={GLOW_BASE_OPACITY} depthWrite={false} />
          </mesh>
          {/* Dark outline ring behind the bright ones, sized just outside them - gives the cue a hard
              edge that reads against ANY background (light board art, another bright piece, the gold
              yard-hole rings this used to disappear into) instead of only against a dark one. */}
          <mesh>
            <ringGeometry args={[PIECE_BASE_RADIUS * 1.5, PIECE_BASE_RADIUS * 2.28, 40]} />
            <meshBasicMaterial color={OUTLINE_COLOR} transparent opacity={0.55} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <mesh ref={ringOuterRef}>
            <ringGeometry args={[PIECE_BASE_RADIUS * 1.55, PIECE_BASE_RADIUS * 1.8, 40]} />
            <meshBasicMaterial color="#ffcc00" transparent opacity={RING_BASE_OPACITY} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <mesh ref={ringInnerRef}>
            {/* Low segment count on purpose - reads as a faceted/angular ring, distinct from the
                smooth outer one, rather than two identical circles just spinning oppositely. */}
            <ringGeometry args={[PIECE_BASE_RADIUS * 2.0, PIECE_BASE_RADIUS * 2.2, 6]} />
            <meshBasicMaterial color="#fff4c2" transparent opacity={RING_BASE_OPACITY} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        </group>
        {/* Thin vertical light beam from the ring up to just under the marker - a "spotlight on this
            exact piece" language nothing else on the board uses, so the cue reads as a directed
            effect even from a wide, zoomed-out camera where the ring/marker themselves are tiny. */}
        <mesh ref={beamRef} position={[0, MARKER_BASE_Y * 0.42, 0]}>
          <cylinderGeometry args={[PIECE_BASE_RADIUS * 0.05, PIECE_BASE_RADIUS * 0.16, MARKER_BASE_Y * 0.8, 10]} />
          <meshBasicMaterial color={GLOW_COLOR} transparent opacity={BEAM_BASE_OPACITY} depthWrite={false} />
        </mesh>
        {/* Floating gem marker above the piece's head - the clearer, more game-familiar "this is
            yours, act on it" cue (bob + spin), on top of the base ring rather than instead of it. */}
        <group ref={markerRef} position={[0, MARKER_BASE_Y, 0]}>
          <mesh>
            <octahedronGeometry args={[MARKER_SIZE * 1.2, 0]} />
            <meshBasicMaterial color={OUTLINE_COLOR} />
          </mesh>
          <mesh>
            <octahedronGeometry args={[MARKER_SIZE, 0]} />
            <meshBasicMaterial color="#ffcc00" transparent opacity={0.95} />
          </mesh>
        </group>
      </group>
    </group>
  )
}
