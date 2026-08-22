import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BOARD_DEFINITIONS } from '../data/boards'
import { getColor } from '../core/colorPalette'
import { BoardMesh } from './BoardMesh'
import { PIECE_PROFILE_RAW, PROFILE_SCALE, PIECE_HEIGHT_SCALE } from './PieceMesh'
import { toWorldPosition, FLAT_SURFACE_HEIGHT, BOARD_SIZE } from './boardGeometry'

// Requested directly: a flat photo (blurred or not) or a CSS pattern both read as "not
// three-dimensional" - a real background needs actual depth (perspective, lighting, shadows), which
// only the game's own Three.js board can genuinely provide, not a 2D asset. Reuses BoardMesh (the
// same textured board plane BoardScene renders) under a slowly auto-rotating camera instead of the
// static/orbit-controlled one gameplay uses, plus a handful of decorative "pieces" (not full
// PieceMesh - those need a real Piece/selectable/onSelect wired to actual game state this screen
// doesn't have) sitting in their yards so the board doesn't read as empty.
const definition = BOARD_DEFINITIONS[4]

// radius/height tuned by eye against BOARD_SIZE=6 (this screen's own BoardMesh, independent of
// BoardScene's own gameplay camera - see that file's own CAMERA_DISTANCE for the same class of
// bug). Reported directly, with a screenshot showing only a few yard hubs, cropped at the edges:
// BOARD_SIZE has grown 3x since (6 -> 18, across several rounds of "pieces are still too small")
// and this camera never followed, unlike BoardScene's own CAMERA_DISTANCE and DiceMesh's own
// DICE_SCALE which both already scale with it - scaled by the same live ratio here instead of a
// second hardcoded number that would just go stale again the next time BOARD_SIZE changes.
const CAMERA_SCALE = BOARD_SIZE / 6

function RotatingCamera() {
  const angleRef = useRef(0)
  useFrame((state, delta) => {
    angleRef.current += delta * 0.06
    const radius = 4.3 * CAMERA_SCALE
    const height = 3.6 * CAMERA_SCALE
    state.camera.position.set(Math.sin(angleRef.current) * radius, height, Math.cos(angleRef.current) * radius)
    state.camera.lookAt(0, 0, 0)
  })
  return null
}

// Reported directly, with a reference photo of a real pawn: plain spheres didn't read as game
// pieces at all. Reuses the exact same lathe-revolved pawn profile as the real in-game PieceMesh
// (exported from there for this) instead of a separate hand-tuned shape, so this decoration
// actually looks like the game's own pawns - just without PieceMesh's animation/selection logic,
// which this screen has no game state to drive.
function DecorativePieces() {
  const profile = useMemo(
    () => PIECE_PROFILE_RAW.map(([r, y]) => new THREE.Vector2(r * PROFILE_SCALE, y * PROFILE_SCALE * PIECE_HEIGHT_SCALE)),
    [],
  )
  const dots: { position: [number, number, number]; color: string }[] = []
  for (const lane of definition.playerLanes) {
    for (const wp of lane.yardWaypoints) {
      dots.push({ position: toWorldPosition(wp, FLAT_SURFACE_HEIGHT), color: getColor(lane.color) })
    }
  }
  return (
    <>
      {dots.map((d, i) => (
        <mesh key={i} position={d.position} castShadow>
          <latheGeometry args={[profile, 24]} />
          <meshPhysicalMaterial color={d.color} roughness={0.25} metalness={0.15} clearcoat={0.7} clearcoatRoughness={0.2} />
        </mesh>
      ))}
    </>
  )
}

export function StartScreenBackground() {
  return (
    <Canvas shadows gl={{ antialias: true }} dpr={[1, 1.5]} camera={{ fov: 45 }}>
      <RotatingCamera />
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 8, 2]} intensity={1.1} castShadow />
      <directionalLight position={[-3, 4, -2]} intensity={0.35} />
      {/* near/far scaled by the same CAMERA_SCALE as RotatingCamera - also tuned against
          BOARD_SIZE=6, so the board's own edges stayed just short of the fog the way they did
          before BOARD_SIZE grew, instead of drifting into it now that everything else sits
          further from the origin. */}
      <fog attach="fog" args={[new THREE.Color('#05070c'), 7 * CAMERA_SCALE, 22 * CAMERA_SCALE]} />
      <Suspense fallback={null}>
        <BoardMesh imageUrl={definition.boardImage} />
        <DecorativePieces />
      </Suspense>
    </Canvas>
  )
}
