import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Mesh } from 'three'

export function DiceMesh({ value, rolling, onClick }: { value: number | null; rolling: boolean; onClick: () => void }) {
  const meshRef = useRef<Mesh>(null)

  useFrame((_, delta) => {
    if (rolling && meshRef.current) {
      meshRef.current.rotation.x += delta * 10
      meshRef.current.rotation.y += delta * 8
    }
  })

  return (
    <group position={[0, 0.35, BOARD_EDGE]}>
      <mesh ref={meshRef} castShadow onClick={onClick}>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshStandardMaterial color="#f2ede0" />
      </mesh>
      {value !== null && !rolling && (
        <Html center distanceFactor={8}>
          <div style={{ fontSize: 24, fontWeight: 'bold', color: '#2a2a2a', pointerEvents: 'none' }}>{value}</div>
        </Html>
      )}
    </group>
  )
}

const BOARD_EDGE = 3.6
