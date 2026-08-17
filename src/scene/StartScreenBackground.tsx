import { Suspense, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BOARD_DEFINITIONS } from '../data/boards'
import { getColor } from '../core/colorPalette'
import { BoardMesh } from './BoardMesh'
import { TableSurface } from './TableSurface'
import { toWorldPosition, FLAT_SURFACE_HEIGHT } from './boardGeometry'

// Requested directly: a flat photo (blurred or not) or a CSS pattern both read as "not
// three-dimensional" - a real background needs actual depth (perspective, lighting, shadows), which
// only the game's own Three.js board can genuinely provide, not a 2D asset. Reuses BoardMesh (the
// same textured board plane BoardScene renders) under a slowly auto-rotating camera instead of the
// static/orbit-controlled one gameplay uses, plus a handful of plain sphere "pieces" (not full
// PieceMesh - those need a real Piece/selectable/onSelect wired to actual game state this screen
// doesn't have) sitting in their yards so the board doesn't read as empty.
const definition = BOARD_DEFINITIONS[4]

function RotatingCamera() {
  const angleRef = useRef(0)
  useFrame((state, delta) => {
    angleRef.current += delta * 0.06
    const radius = 4.3
    const height = 3.6
    state.camera.position.set(Math.sin(angleRef.current) * radius, height, Math.cos(angleRef.current) * radius)
    state.camera.lookAt(0, 0, 0)
  })
  return null
}

function DecorativePieces() {
  const dots: { position: [number, number, number]; color: string }[] = []
  for (const lane of definition.playerLanes) {
    for (const wp of lane.yardWaypoints) {
      dots.push({ position: toWorldPosition(wp, FLAT_SURFACE_HEIGHT + 0.06), color: getColor(lane.color) })
    }
  }
  return (
    <>
      {dots.map((d, i) => (
        <mesh key={i} position={d.position} castShadow>
          <sphereGeometry args={[0.14, 24, 18]} />
          <meshPhysicalMaterial color={d.color} roughness={0.25} metalness={0.1} clearcoat={0.7} clearcoatRoughness={0.2} />
        </mesh>
      ))}
    </>
  )
}

export function StartScreenBackground() {
  return (
    <Canvas shadows gl={{ antialias: true }} dpr={[1, 1.5]} camera={{ fov: 45 }}>
      <RotatingCamera />
      {/* Same warm, board-focused lighting as the in-game scene (see BoardScene) - a dim ambient
          fill plus a focused warm spotlight, so the menu background reads as the same cozy
          candlelit table the game itself sits on, not a separately-lit backdrop. */}
      <ambientLight intensity={0.4} />
      <spotLight position={[0, 8, 1.5]} angle={0.65} penumbra={0.6} intensity={2.2} color="#fff2d8" castShadow decay={1.6} />
      <directionalLight position={[-3, 4, -2]} intensity={0.25} color="#cfd8ff" />
      <fog attach="fog" args={[new THREE.Color('#100a06'), 7, 22]} />
      <Suspense fallback={null}>
        <TableSurface />
        <BoardMesh imageUrl={definition.boardImage} />
        <DecorativePieces />
      </Suspense>
    </Canvas>
  )
}
