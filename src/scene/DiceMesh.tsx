import { useEffect, useMemo, useRef } from 'react'
import { extend, useFrame, type BufferGeometryNode } from '@react-three/fiber'
import * as THREE from 'three'
import type { Mesh } from 'three'
import { RoundedBoxGeometry } from 'three-stdlib'
import { BOARD_SIZE } from './boardGeometry'
import { setInteractiveCursorActive } from './interactiveCursorState'

extend({ RoundedBoxGeometry })

// Every position/size constant below was tuned by eye against BOARD_SIZE=6 (see CORNER_X/CORNER_Z's
// own comment). BOARD_SIZE has grown since (currently 12) to give pieces more room, and everything
// derived from board-image coordinates (toWorldPosition, the track loop itself) scales with it - but
// these constants are hand-picked absolute world units, not derived from BOARD_SIZE, so they didn't
// grow along with the board around them. Reported directly, with a screenshot: the dice tray had
// drifted from its tuned gap (past the board's own edge) onto real track squares, since the edge
// moved outward while these stayed put. Scaling everything here by the same ratio BOARD_SIZE grew by
// keeps the tray in the same *relative* spot - the gap between the logo badge and the fleur-de-lis -
// regardless of which BOARD_SIZE is live.
const DICE_SCALE = BOARD_SIZE / 6

declare global {
  namespace JSX {
    interface IntrinsicElements {
      roundedBoxGeometry: BufferGeometryNode<RoundedBoxGeometry, typeof RoundedBoxGeometry>
    }
  }
}

// Two prior positions both sat *past* the board's own edge (world X or Z > 3), which put them at
// the mercy of the tilted camera's own margin past the board - inconsistent across viewport shapes
// (reported directly, twice: resting on real track squares on one edge, then pushed half off-screen
// on the other). Sitting *inside* the board's own footprint instead removes that dependency
// entirely: as long as the board itself is on screen (guaranteed by FitBoardCamera), so is this
// spot. The bottom-right corner has the most consistent clearance from any real track square across
// all five boards, but the exact corner also has the board art's own "Parkiller" logo badge sitting
// there (reported directly: the dice were drawn right on top of it) - nudged in from the corner to
// the gap between that badge and the fleur-de-lis ornament above it instead.
//
// CORNER_Z bumped again (1.55 -> 1.75), reported directly with a screenshot ("주사위가 자리길을
// 침범하고있다 로고가있는 아래쪽으로 약간 내려오게해달라" - the dice are encroaching on the track,
// move them down slightly toward the logo) - the board's own BOARD_SIZE grew since the "0.091
// normalized units" clearance this constant was originally tuned against, closing that gap on the
// tightest boards (confirmed directly, in-browser, on 2p/4p/6p: the white dice's own near corner
// was overlapping the last blue/red track square before this). Moved further toward the Parkiller
// badge, away from the fleur-de-lis, re-verified clear of the track on all three checked boards.
//
// Moved again, reported directly, with a screenshot on the 4-player board: the dice take up part of
// the track, move them down so the track isn't covered (a pawn walking that stretch can also end up
// hidden behind them - part of the "pawns keep disappearing" report).
// The last tuning was by eye on three boards; measured properly this time instead: distance from each
// die's footprint to every track and home-corridor square on ALL five boards (tile half-width from
// the board's own estimateSquareSize, protected squares at their full 1.8x width). The old position
// overlapped tiles on the 4-player board (about -3.1 world units of clearance), the 6-player board
// (-1.8) and grazed the 5-player one.
//
// "Just move it further down/right" isn't available: two first attempts pushed dice off the visible
// area (the black die's lower half below a 16:9 viewport, then the right-hand dice past the right
// edge on 1.5:1 windows) - the camera crops the near corners differently per window shape, and the
// nearer a die sits to the camera (larger z) the less far right it can go (perspective). So every
// candidate was held to the frontier the *old* layout already proved visible - right edge no further
// than 23.4 - 0.51 * (z - 16) world units, bottom edge no further than 22.7 - and searched on all
// five boards. The only arrangement with real clearance is an L: the two white dice side by side
// along the bottom, the black (Parkiller) die behind and slightly right of the right-hand white one
// (column 0.75, row -1 in BoardScene - a negative row sits *further* from the camera than the white
// pair, i.e. higher on screen/behind them), with the dice a touch smaller (0.34 -> 0.32) - dice were
// reported as too large twice before, so this goes the same direction.
// Checked by screenshot on all five boards at 16:9, 1.5:1, 4:3 and phone-portrait windows: the tray
// clears every track square (it overlapped them on the 4-, 5- and 6-player boards before) and is no
// more cropped at the window edge than the old layout was.
//
// Reported directly again, with a screenshot: that row=-1 read as sitting way up near the board's
// own corner decoration, not "underneath" the white pair as asked. A first correction moved it to
// row=0.35 (closer to the camera than the white pair, column still 0.62, roughly where the old
// row=-1 spot's own column had been) - checked at the time only against arbitrary tight corner
// crops, which turned out to mask a real crop: on a 4:3 window specifically, the visible-frontier's
// right edge is far tighter than this file's own reference formula above ever accounted for once z
// increases at all - even column 0.75 at row 0 (the white pair's own z, no forward push whatsoever)
// already crops on a 4:3 window, a case never actually screenshotted head-on before shipping. Bisected
// directly against full, uncropped screenshots (not corner crops) this time: at row 0 the safe column
// ceiling on a 4:3 window is only about 0.5 - almost exactly the right-hand white die's own column,
// leaving no real room to its right at all without cropping.
//
// Reported a second time, with a screenshot: that row=0.35/column=0.62 spot also read as overlapping
// the white pair too heavily (confirmed - only ~1.4 world units between die centers there, well
// under the ~2.9 that would clear them). Tried centering it *between* the two white dice instead
// (column 0, same row 0.3) - reported a third time, with a screenshot, as still overlapping: a die
// this size simply doesn't fit in the ~0.8-world-unit gap between two adjacent dice one column step
// apart without covering most of one or both, regardless of depth.
//
// The frontier constraint above is specifically about the *right* edge tightening as z grows - it
// says nothing about going further left, which has no such limit. Moved the black die to the
// *left* of the white pair instead (column -0.9, same row 0.3) - reported a fourth time, with a
// screenshot, as STILL overlapping: -0.9 is only 0.4 columns left of the left-hand white die's own
// -0.5, and clearing a die of this size needs DIE_SIZE/DIE_SPACING ≈ 0.78 columns of separation
// (checked directly this time, not estimated by eye) - -0.9 was still under half that, actually
// overlapping by close to half the die's own width, the exact bug reported. Column -1.6 gives
// ~1.2 columns of separation - comfortably past that 0.78 minimum, with a real, visible gap left
// over on top, not just barely clearing. Re-verified against full, uncropped screenshots (not
// corner crops), zoomed in tight enough to actually see whether the dice touch, on all five boards
// at 16:9, 1.5:1, 4:3 and phone-portrait windows.
const CORNER_X = 1.898 * DICE_SCALE
const CORNER_Z = 2.28 * DICE_SCALE
const DIE_SPACING = 0.409 * DICE_SCALE
// The black die sits a modest step closer to the camera than the white pair (`row=0.3` in
// BoardScene, not a full 1) and to their *left* (`column=-1.6`, past the left-hand white die's own
// -0.5 by roughly double the ~0.78-column gap a die this size actually needs to clear it) - see
// CORNER_X/CORNER_Z's own comment for the several rounds of overlap/crop reports that ruled out
// sitting to the right, directly between them, or too close to their left instead.
const ROW_SPACING = 0.409 * DICE_SCALE
// Reported directly, twice now: the dice read as too large on the board - not by a lot, just
// enough to feel oversized next to the pieces. Trimmed about a sixth off (0.5 -> 0.42) the first
// time, then further (0.42 -> 0.34) the second - keeping DIE_SPACING/ROW_SPACING as-is (smaller
// dice only means more clearance between them, never less).
// Trimmed a third time (0.34 -> 0.32) - see CORNER_X/CORNER_Z above for why: a slightly smaller die is
// part of what lets the tray clear the track inside the already-proven-visible corner.
const DIE_SIZE = 0.32 * DICE_SCALE
// Reference photos had previously shown the black die - the one that moves the Parkiller -
// noticeably bigger than the two white dice, so it was scaled up 30% to match. Reported directly
// since, in the shipped game itself rather than those reference photos: make it the same size as
// the white pair instead - reverted to 1.
const BLACK_DIE_SCALE = 1
const BLACK_DIE_SIZE = DIE_SIZE * BLACK_DIE_SCALE

// Found via frame-by-frame review of a real local-play recording (b1_0250.jpg, mid-spin): all
// three dice - both white ones and the black Parkiller die - showed byte-for-byte identical pip
// orientation at the same instant, because every <DiceMesh> receives the exact same `rolling`
// boolean (BoardScene.tsx's three call sites) and this used to advance rotation by a single fixed
// rate (`delta*10`/`delta*8`) with no per-die variation - so three meshes fed the same `delta`
// this frame always land on the exact same rotation. The `nudge` branch just below already solves
// this same "reads as one rigid block" problem for the idle-nudge animation via `phaseOffset` (see
// its own comment above); this carries that same per-die decorrelation over to the actual
// roll-tumble, so each die spins at its own distinct rate and no longer mirrors the other two
// frame-for-frame. Kept as a standalone pure function (rather than inlined in useFrame) so the
// three dice's rotation deltas for a shared `delta` can be compared directly in a unit test -
// there's no React-rendering test harness in this project to drive useFrame itself.
export function rollingRotationDelta(delta: number, phaseOffset: number): { x: number; y: number } {
  return {
    x: delta * (10 + phaseOffset),
    y: delta * (8 - phaseOffset * 0.6),
  }
}

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
const NUDGE_BOUNCE_HEIGHT = 0.06 * DICE_SCALE
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
  interactive = true,
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
  /** Mirrors whether onClick would actually roll right now (GameBoardScreen's own canRoll) - onClick
   * itself stays wired unconditionally and just no-ops otherwise, so the hover cursor needs this
   * separate signal to only read as clickable when a click would really do something. Requested
   * directly ("마우스지시자를 주사위를누를때... cursor-pointer로 만들어달라" - make the mouse cursor a
   * pointer when hovering the dice). */
  interactive?: boolean
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
  useEffect(() => {
    return () => faceTextures.forEach((tex) => tex.dispose())
  }, [faceTextures])

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
  // Reported directly - the game gets progressively slower to render the longer a session runs.
  // This rebuilds 6 brand new MeshPhysicalMaterial instances on every roll (value changes every
  // turn, for the whole game), and three.js never frees a material's GPU-side program/uniform
  // state on its own - only an explicit .dispose() call does, same as the geometry leak fixed in
  // BoardScene/TrackTile. Disposing the outgoing set whenever a fresh one replaces it (or this die
  // unmounts) keeps that from accumulating over a long game instead of relying on whether
  // <primitive>'s own object-swap happens to dispose it automatically.
  useEffect(() => {
    return () => materials.forEach((mat) => mat.dispose())
  }, [materials])

  // Small per-die offset (from its own table position) so all three don't bounce/rock in exact
  // lockstep during a nudge - reads as more alive, less like one rigid block moving together.
  const phaseOffset = useMemo(() => (column + row * 2) * 0.4, [column, row])

  useFrame((state, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    if (rolling) {
      const { x, y } = rollingRotationDelta(delta, phaseOffset)
      mesh.rotation.x += x
      mesh.rotation.y += y
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
      <mesh
        ref={meshRef}
        castShadow
        onClick={onClick}
        onPointerOver={() => {
          if (interactive) setInteractiveCursorActive(true)
        }}
        onPointerOut={() => {
          if (interactive) setInteractiveCursorActive(false)
        }}
      >
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
