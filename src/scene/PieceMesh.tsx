import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Mesh } from 'three'
import { getColor } from '../core/colorPalette'
import type { Piece } from '../core/pieces/piece'
import { BASE_HEIGHT } from './boardGeometry'

const HOP_DURATION = 0.22 // seconds per square hopped
const BOUNCE_HEIGHT = 0.16 // world units, how high each hop arcs

interface PieceMeshProps {
  piece: Piece
  restPosition: [number, number, number]
  /** Set only for the one piece currently animating a move; null means "just sit at restPosition". */
  hopFrom: [number, number, number] | null
  hops: [number, number, number][]
  onHopsComplete?: () => void
  selectable: boolean
  onSelect: (piece: Piece) => void
}

// Renders as a small bouncing ball rather than a flat token: at board scale a flat disc barely
// shows how far it travelled between rolls, but a ball that visibly arcs once per square makes
// the step count countable at a glance.
export function PieceMesh({ piece, restPosition, hopFrom, hops, onHopsComplete, selectable, onSelect }: PieceMeshProps) {
  const meshRef = useRef<Mesh>(null)
  const hopIndexRef = useRef(0)
  const elapsedRef = useRef(0)
  const notifiedRef = useRef(true)

  useEffect(() => {
    hopIndexRef.current = 0
    elapsedRef.current = 0
    notifiedRef.current = hops.length === 0
  }, [hops])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh) return

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

  return (
    <mesh
      ref={meshRef}
      position={restPosition}
      castShadow
      onClick={(e) => {
        if (!selectable) return
        e.stopPropagation()
        onSelect(piece)
      }}
      scale={selectable ? 1.3 : 1}
    >
      <sphereGeometry args={[0.14, 20, 16]} />
      <meshStandardMaterial
        color={getColor(piece.color)}
        emissive={selectable ? getColor(piece.color) : '#000000'}
        emissiveIntensity={selectable ? 0.5 : 0}
      />
    </mesh>
  )
}
