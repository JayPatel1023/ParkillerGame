import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Mesh } from 'three'

const IMPACT_DURATION = 0.4 // seconds
// The flash punches out and fades well before the ring finishes, so the two don't just look like
// one blob scaling up together - a quick bright hit followed by a slower-fading shockwave.
const FLASH_DURATION = IMPACT_DURATION * 0.4
const RING_END_SCALE = 6
const FLASH_END_SCALE = 2.4

interface CaptureImpactEffectProps {
  position: [number, number, number]
  color: string
  onComplete: () => void
}

// A brief burst at the square a piece was captured on - an expanding, fading ring in the captured
// piece's own color plus a quick white flash at its center - so a capture reads as an impact
// rather than the piece quietly disappearing.
export function CaptureImpactEffect({ position, color, onComplete }: CaptureImpactEffectProps) {
  const elapsedRef = useRef(0)
  const doneRef = useRef(false)
  const ringRef = useRef<Mesh>(null)
  const flashRef = useRef<Mesh>(null)

  useFrame((_, delta) => {
    if (doneRef.current) return
    elapsedRef.current += delta
    const t = Math.min(1, elapsedRef.current / IMPACT_DURATION)
    const eased = 1 - (1 - t) * (1 - t) // fast start, easing out - a punch, not a linear grow

    if (ringRef.current) {
      ringRef.current.scale.setScalar(1 + eased * (RING_END_SCALE - 1))
      ;(ringRef.current.material as THREE.MeshBasicMaterial).opacity = 1 - t
    }
    if (flashRef.current) {
      const flashT = Math.min(1, elapsedRef.current / FLASH_DURATION)
      flashRef.current.scale.setScalar(1 + flashT * (FLASH_END_SCALE - 1))
      ;(flashRef.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - flashT)
    }

    if (t >= 1) {
      doneRef.current = true
      onComplete()
    }
  })

  return (
    <group position={position}>
      <mesh ref={flashRef}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={1} depthWrite={false} />
      </mesh>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.05, 0.075, 32]} />
        <meshBasicMaterial color={color} transparent opacity={1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  )
}
