import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useTexture } from '@react-three/drei'

// Isolated preview of exactly one track-square component, cropped from the square the client
// marked in red on the 5-player board. Nothing else is rendered - no board, no other tiles, no
// pieces - so this one piece can be checked and approved on its own before building/placing any
// more. Reached via #component in the URL (see App.tsx).
interface TileComponentProps {
  /** Degrees - rotates the tile in-plane, for matching it to a spot along the path's curve. */
  angle: number
  /** Tints the fill layer (the border stays real, untinted gold regardless of this). */
  color: string
}

function TileComponent({ angle, color }: TileComponentProps) {
  const fillTexture = useTexture('/tiles/component2-fill.png')
  const borderTexture = useTexture('/tiles/component2-border.png')

  return (
    <group rotation={[-Math.PI / 2, 0, (angle * Math.PI) / 180]}>
      <mesh position={[0, 0, -0.005]}>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial map={fillTexture} color={color} transparent />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial map={borderTexture} transparent />
      </mesh>
    </group>
  )
}

const COLOR_PRESETS: Record<string, string> = {
  Blue: '#386b94',
  Red: '#ba2828',
  Gold: '#cc9e33',
  Green: '#296b47',
  Purple: '#73529e',
  Orange: '#d18040',
}

export default function ComponentPreview() {
  const [angle, setAngle] = useState(0)
  const [color, setColor] = useState(COLOR_PRESETS.Blue)

  return (
    <div style={{ height: '100vh', background: '#1a1a1a', position: 'relative' }}>
      <Canvas shadows camera={{ position: [0, 1.6, 1.2], fov: 40 }}>
        <ambientLight intensity={1.4} />
        <directionalLight position={[2, 3, 2]} intensity={0.9} />
        <directionalLight position={[-2, 2, -1]} intensity={0.5} />
        <Suspense fallback={null}>
          <TileComponent angle={angle} color={color} />
        </Suspense>
        <OrbitControls />
      </Canvas>

      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          background: 'rgba(30,30,30,0.9)',
          border: '1px solid #555',
          borderRadius: 8,
          padding: 16,
          color: '#eee',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 14,
          width: 240,
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <label>
            angle: {angle}&deg;
            <input
              type="range"
              min={-180}
              max={180}
              value={angle}
              onChange={(e) => setAngle(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </label>
        </div>
        <div>
          <div style={{ marginBottom: 6 }}>gradient color:</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(COLOR_PRESETS).map(([name, hex]) => (
              <button
                key={name}
                onClick={() => setColor(hex)}
                title={name}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: hex,
                  border: color === hex ? '2px solid white' : '1px solid #666',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ marginTop: 8, width: '100%' }}
          />
        </div>
      </div>
    </div>
  )
}
