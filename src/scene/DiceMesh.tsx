import { useEffect, useMemo, useRef } from 'react'
import { extend, useFrame, type BufferGeometryNode } from '@react-three/fiber'
import * as THREE from 'three'
import type { Mesh } from 'three'
import { RoundedBoxGeometry } from 'three-stdlib'

extend({ RoundedBoxGeometry })

declare global {
  namespace JSX {
    interface IntrinsicElements {
      roundedBoxGeometry: BufferGeometryNode<RoundedBoxGeometry, typeof RoundedBoxGeometry>
    }
  }
}

// Was the board's own back-right corner (sat *inside* the board's footprint, in the gap between
// the "Parkiller" logo badge and the fleur-de-lis ornament above it - the only spot with
// consistent clearance from the real track across all five boards). Moved front-and-center per a
// full written brief: dice shouldn't just sit wherever there's room on the board art, they belong
// in their own dedicated tray at the bottom-center of the view (see DiceTray, added in BoardScene)
// - still real 3D objects on the board's own near edge, not an unrelated HTML overlay.
const CORNER_X = 0
const CORNER_Z = 2.55
const DIE_SPACING = 0.55
// The black die sits on its own row behind the two white ones (see `row` below) - a taller row
// gap than the plain column spacing, since the black die is now physically bigger and would
// otherwise overlap the white dice's row.
const ROW_SPACING = 0.66
// Reported directly: the dice read as too large on the board - not by a lot, just enough to feel
// oversized next to the pieces. Trimmed about a sixth off (0.5 -> 0.42), keeping DIE_SPACING/
// ROW_SPACING as-is (smaller dice only means more clearance between them, never less).
const DIE_SIZE = 0.42
// Reference photos (reported directly, twice) show the black die - the one that moves the
// Parkiller - is noticeably bigger than the two white dice, not the same size with just a
// different color. 30% bigger reads as clearly larger without dwarfing the white pair.
const BLACK_DIE_SCALE = 1.3
const BLACK_DIE_SIZE = DIE_SIZE * BLACK_DIE_SCALE

function pipPositions(value: number): [number, number][] {
  switch (value) {
    case 1:
      return [[0, 0]]
    case 2:
      return [
        [-1, -1],
        [1, 1],
      ]
    case 3:
      return [
        [-1, -1],
        [0, 0],
        [1, 1],
      ]
    case 4:
      return [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]
    case 5:
      return [
        [-1, -1],
        [1, -1],
        [0, 0],
        [-1, 1],
        [1, 1],
      ]
    case 6:
      return [
        [-1, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [1, 1],
      ]
    default:
      return []
  }
}

// A real die's pips are small punched-in hemispheres, not flat printed dots - fake that with a
// tight radial shadow ring around each one so it reads as a dimple even under flat ambient light.
// Colors are parameterized so the same drawing logic produces both the white dice (white body,
// black pips) and the Parkiller's own "black die with white dots" (PK2) from one function.
function createDiceFaceTexture(value: number, bodyColors: [string, string], pipColor: string): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // Soft radial vignette instead of a flat fill, closer to glossy injection-molded plastic than a
  // flat card face.
  const bg = ctx.createRadialGradient(size * 0.4, size * 0.35, size * 0.1, size * 0.5, size * 0.5, size * 0.75)
  bg.addColorStop(0, bodyColors[0])
  bg.addColorStop(1, bodyColors[1])
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, size, size)

  const pipRadius = size * 0.1
  const margin = size * 0.24
  const shadowColor = pipColor === '#1c1c1c' ? '0,0,0' : '255,255,255'
  const highlightColor = pipColor === '#1c1c1c' ? '255,255,255' : '0,0,0'
  for (const [px, py] of pipPositions(value)) {
    const cx = size / 2 + px * margin
    const cy = size / 2 + py * margin

    const shadow = ctx.createRadialGradient(cx, cy, pipRadius * 0.2, cx, cy, pipRadius * 1.35)
    shadow.addColorStop(0, `rgba(${shadowColor},0.0)`)
    shadow.addColorStop(0.7, `rgba(${shadowColor},0.0)`)
    shadow.addColorStop(0.85, `rgba(${shadowColor},0.18)`)
    shadow.addColorStop(1, `rgba(${shadowColor},0)`)
    ctx.fillStyle = shadow
    ctx.beginPath()
    ctx.arc(cx, cy, pipRadius * 1.35, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = pipColor
    ctx.beginPath()
    ctx.arc(cx, cy, pipRadius, 0, Math.PI * 2)
    ctx.fill()

    // Tiny offset highlight so each pip reads as a rounded bead rather than a flat disc.
    ctx.fillStyle = `rgba(${highlightColor},0.35)`
    ctx.beginPath()
    ctx.arc(cx - pipRadius * 0.3, cy - pipRadius * 0.35, pipRadius * 0.3, 0, Math.PI * 2)
    ctx.fill()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

// Idle nudge (see GameBoardScreen.tsx's own idle timer): a gentle repeating hop + side-to-side
// rock, clearly distinct from the fast tumbling `rolling` spin below, so it reads as "someone's
// waiting on you" rather than as the dice already rolling on their own.
const NUDGE_BOUNCE_HEIGHT = 0.06
const NUDGE_FREQ = 3.2

// Settle punch + sparkle flash, requested directly ("반짝임/펄스" - a flash/pulse the instant a
// roll's result appears): the die used to just stop tumbling and sit there, no reveal moment at
// all. A brief overshoot scale-bounce plus a quick white flash sphere reads as "the result landed"
// - both fire together, timed off the same wasRolling->!rolling transition the orientation-settle
// already used.
const SETTLE_PULSE_DURATION = 0.35
const SETTLE_FLASH_DURATION = 0.22

export function DiceMesh({
  value,
  rolling,
  nudge = false,
  onClick,
  column,
  row = 0,
  black = false,
}: {
  value: number | null
  rolling: boolean
  /** True once this player's turn has sat unrolled past the idle threshold - see
   * GameBoardScreen.tsx's own idle timer, which is the single source of truth for the 60s delay
   * so it isn't duplicated (and drifting) per die. */
  nudge?: boolean
  onClick: () => void
  /** Horizontal slot among however many dice are laid out together, centered on 0 (e.g. -0.5/0.5
   * for 2 dice) - the caller works out the exact layout since it knows how many dice are on the
   * table at once. */
  column: number
  /** Front-to-back slot, same units as column - 0 keeps the original single-row layout; used to
   * sit the Parkiller's black die just behind the two white dice instead of widening the row (the
   * row's own X range was already tuned to clear the board's real track/artwork at this corner -
   * see CORNER_X/CORNER_Z - so this avoids re-tuning that for a 3rd die). */
  row?: number
  /** PK2's own die - a black body with white dots, rolled and resolved separately from the two
   * white dice. */
  black?: boolean
}) {
  const meshRef = useRef<Mesh>(null)
  const flashRef = useRef<Mesh>(null)
  const wasRolling = useRef(rolling)
  const settleElapsedRef = useRef(Infinity)

  const size = black ? BLACK_DIE_SIZE : DIE_SIZE
  // The die's own geometry is centered on its local origin, so resting it on the flat board plane
  // (y=0) means lifting that center by half the die's own height - was a flat 0.35, well above the
  // white die's 0.25 half-height, leaving a visible gap/shadow between the die and the board.
  const restY = size / 2

  const bodyColors: [string, string] = black ? ['#3a3a3a', '#161616'] : ['#ffffff', '#e9e7e2']
  const pipColor = black ? '#f5f5f5' : '#1c1c1c'

  // Six canvas-drawn pip textures, generated once and reused across rolls.
  const faceTextures = useMemo(() => [1, 2, 3, 4, 5, 6].map((n) => createDiceFaceTexture(n, bodyColors, pipColor)), [black])

  // Box face order is [+x, -x, +y (top), -y (bottom), +z, -z]. The current value always sits on
  // top with its real-die complement (sums to 7) on the bottom; the sides just take whatever's
  // left, since the roll animation doesn't track real per-face orientation.
  const materials = useMemo(() => {
    const val = value ?? 1
    const opposite = 7 - val
    const remaining = [1, 2, 3, 4, 5, 6].filter((n) => n !== val && n !== opposite)
    const order = [remaining[0], remaining[1], val, opposite, remaining[2], remaining[3]]
    // Low roughness (not a flat matte card face) + a touch of clearcoat-like sheen from the
    // scene's directional light reads as the smooth, glossy injection-molded plastic in the
    // reference photo, instead of the flat cardboard look a fully matte material gives.
    return order.map(
      (n) =>
        new THREE.MeshPhysicalMaterial({
          map: faceTextures[n - 1],
          roughness: 0.28,
          clearcoat: 0.6,
          clearcoatRoughness: 0.25,
        }),
    )
  }, [value, faceTextures])

  // Small per-die offset (from its own table position) so all three don't bounce/rock in exact
  // lockstep during a nudge - reads as more alive, less like one rigid block moving together.
  const phaseOffset = useMemo(() => (column + row * 2) * 0.4, [column, row])

  useFrame((state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    if (rolling) {
      mesh.rotation.x += delta * 10
      mesh.rotation.y += delta * 8
      return
    }
    if (nudge) {
      const t = state.clock.elapsedTime + phaseOffset
      mesh.position.y = Math.max(0, Math.sin(t * NUDGE_FREQ)) * NUDGE_BOUNCE_HEIGHT
      mesh.rotation.z = Math.sin(t * NUDGE_FREQ * 0.85) * 0.12
    } else if (mesh.position.y !== 0 || mesh.rotation.z !== 0) {
      mesh.position.y = 0
      mesh.rotation.z = 0
    }

    // Scale channel is untouched by the rolling/nudge logic above, so this layers on top of
    // either state with no interference.
    settleElapsedRef.current += delta
    if (settleElapsedRef.current < SETTLE_PULSE_DURATION) {
      const st = settleElapsedRef.current / SETTLE_PULSE_DURATION
      const bounce = Math.sin(st * Math.PI) * (1 - st)
      mesh.scale.setScalar(1 + bounce * 0.28)
    } else if (mesh.scale.x !== 1) {
      mesh.scale.setScalar(1)
    }

    if (flashRef.current) {
      if (settleElapsedRef.current < SETTLE_FLASH_DURATION) {
        const ft = settleElapsedRef.current / SETTLE_FLASH_DURATION
        flashRef.current.visible = true
        flashRef.current.scale.setScalar(size * (0.7 + ft * 1.6))
        ;(flashRef.current.material as THREE.MeshBasicMaterial).opacity = 1 - ft
      } else if (flashRef.current.visible) {
        flashRef.current.visible = false
      }
    }
  })

  useEffect(() => {
    // Settle to a clean orientation once the roll resolves, so the face holding the correct pip
    // count actually ends up facing up instead of wherever the spin happened to stop.
    if (wasRolling.current && !rolling && meshRef.current) {
      meshRef.current.rotation.set(0, 0, 0)
      settleElapsedRef.current = 0
    }
    wasRolling.current = rolling
  }, [rolling])

  return (
    <group position={[CORNER_X + column * DIE_SPACING, restY, CORNER_Z + row * ROW_SPACING]}>
      <mesh ref={meshRef} castShadow onClick={onClick}>
        {/* Rounded corners/edges (not a sharp cardboard cube) to match the reference die photo -
            RoundedBoxGeometry extends BoxGeometry so it keeps the same 6 face-material groups. */}
        <roundedBoxGeometry args={[size, size, size, 4, size * 0.16]} />
        {materials.map((mat, i) => (
          <primitive key={i} object={mat} attach={`material-${i}`} />
        ))}
      </mesh>
      <mesh ref={flashRef} visible={false}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}
