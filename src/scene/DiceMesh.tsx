import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Mesh } from 'three'

const BOARD_EDGE = 2.5 // in front of the board, within the camera's frustum

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

function createDiceFaceTexture(value: number): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#f2ede0'
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = '#c9c0ab'
  ctx.lineWidth = 4
  ctx.strokeRect(3, 3, size - 6, size - 6)

  ctx.fillStyle = '#2a2a2a'
  const pipRadius = size * 0.09
  const margin = size * 0.24
  for (const [px, py] of pipPositions(value)) {
    const cx = size / 2 + px * margin
    const cy = size / 2 + py * margin
    ctx.beginPath()
    ctx.arc(cx, cy, pipRadius, 0, Math.PI * 2)
    ctx.fill()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

export function DiceMesh({ value, rolling, onClick }: { value: number | null; rolling: boolean; onClick: () => void }) {
  const meshRef = useRef<Mesh>(null)
  const wasRolling = useRef(rolling)

  // Six canvas-drawn pip textures, generated once and reused across rolls.
  const faceTextures = useMemo(() => [1, 2, 3, 4, 5, 6].map(createDiceFaceTexture), [])

  // Box face order is [+x, -x, +y (top), -y (bottom), +z, -z]. The current value always sits on
  // top with its real-die complement (sums to 7) on the bottom; the sides just take whatever's
  // left, since the roll animation doesn't track real per-face orientation.
  const materials = useMemo(() => {
    const val = value ?? 1
    const opposite = 7 - val
    const remaining = [1, 2, 3, 4, 5, 6].filter((n) => n !== val && n !== opposite)
    const order = [remaining[0], remaining[1], val, opposite, remaining[2], remaining[3]]
    return order.map((n) => new THREE.MeshStandardMaterial({ map: faceTextures[n - 1] }))
  }, [value, faceTextures])

  useFrame((_, delta) => {
    if (rolling && meshRef.current) {
      meshRef.current.rotation.x += delta * 10
      meshRef.current.rotation.y += delta * 8
    }
  })

  useEffect(() => {
    // Settle to a clean orientation once the roll resolves, so the face holding the correct pip
    // count actually ends up facing up instead of wherever the spin happened to stop.
    if (wasRolling.current && !rolling && meshRef.current) {
      meshRef.current.rotation.set(0, 0, 0)
    }
    wasRolling.current = rolling
  }, [rolling])

  return (
    <group position={[0, 0.35, BOARD_EDGE]}>
      <mesh ref={meshRef} castShadow onClick={onClick}>
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        {materials.map((mat, i) => (
          <primitive key={i} object={mat} attach={`material-${i}`} />
        ))}
      </mesh>
    </group>
  )
}
