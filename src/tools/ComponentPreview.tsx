import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useTexture } from '@react-three/drei'

// Isolated preview of exactly one track-square component, cropped from the square the client
// marked in red on the 5-player board (the blue square right before the curve straightens out
// near the top-left). Nothing else is rendered - no board, no other tiles, no pieces - so this one
// piece can be checked and approved on its own before building/placing any more. Reached via
// #component in the URL (see App.tsx).
function SingleTile() {
  const fillTexture = useTexture('/tiles/component-fill.png')
  const borderTexture = useTexture('/tiles/component-border.png')

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <mesh position={[0, 0, -0.01]} receiveShadow>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial map={fillTexture} color="#386b94" />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial map={borderTexture} transparent />
      </mesh>
    </group>
  )
}

export default function ComponentPreview() {
  return (
    <div style={{ height: '100vh', background: '#1a1a1a' }}>
      <Canvas shadows camera={{ position: [0, 1.6, 1.2], fov: 40 }}>
        {/* Brighter/more even lighting than the main game scene - this view isolates one tile
            at large zoom with nothing else around it, so its own natural vignette (confirmed
            present in the source art itself, not introduced here) reads as much starker than
            it does in context on the full board, where neighboring tiles soften it. More light
            here is just for clearer inspection, not a change to the actual game's lighting. */}
        <ambientLight intensity={1.4} />
        <directionalLight position={[2, 3, 2]} intensity={0.9} />
        <directionalLight position={[-2, 2, -1]} intensity={0.5} />
        <Suspense fallback={null}>
          <SingleTile />
        </Suspense>
        <OrbitControls />
      </Canvas>
    </div>
  )
}
