import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { InstancedMesh, Mesh } from 'three'

const IMPACT_DURATION = 0.4 // seconds
// The flash punches out and fades well before the ring finishes, so the two don't just look like
// one blob scaling up together - a quick bright hit followed by a slower-fading shockwave.
const FLASH_DURATION = IMPACT_DURATION * 0.4
const RING_END_SCALE = 6
const FLASH_END_SCALE = 2.4

// Small flying debris chips, on top of the ring+flash - requested directly ("more impact" on a
// capture): a flat expanding ring alone reads as a shockwave but not as something being knocked
// apart. Chips launch outward and slightly upward in random directions, arc under gravity, and
// spin/fade out - PARTICLE_LIFETIME is a bit longer than IMPACT_DURATION so they're still visibly
// falling/fading after the ring/flash have already finished, rather than all three elements
// vanishing in lockstep (which reads as one timed animation, not a physical burst).
const PARTICLE_COUNT = 14
const PARTICLE_LIFETIME = 0.62
const GRAVITY = 2.6

interface Particle {
  velocity: THREE.Vector3
  spin: THREE.Vector3
  scale: number
}

interface CaptureImpactEffectProps {
  position: [number, number, number]
  color: string
  onComplete: () => void
}

// A brief burst at the square a piece was captured on - an expanding, fading ring in the captured
// piece's own color, a quick white flash at its center, and a handful of flying debris chips - so
// a capture reads as an impact rather than the piece quietly disappearing.
export function CaptureImpactEffect({ position, color, onComplete }: CaptureImpactEffectProps) {
  const elapsedRef = useRef(0)
  const doneRef = useRef(false)
  const ringRef = useRef<Mesh>(null)
  const flashRef = useRef<Mesh>(null)
  const particlesRef = useRef<InstancedMesh>(null)

  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: PARTICLE_COUNT }, () => {
        const angle = Math.random() * Math.PI * 2
        const speed = 0.9 + Math.random() * 1.1
        return {
          velocity: new THREE.Vector3(Math.cos(angle) * speed, 1.4 + Math.random() * 1.3, Math.sin(angle) * speed),
          spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
          scale: 0.02 + Math.random() * 0.022,
        }
      }),
    [],
  )

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const particleMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }), [color])

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

    const pt = Math.min(1, elapsedRef.current / PARTICLE_LIFETIME)
    if (particlesRef.current) {
      particles.forEach((p, i) => {
        const time = pt * PARTICLE_LIFETIME
        dummy.position.set(
          p.velocity.x * time,
          p.velocity.y * time - 0.5 * GRAVITY * time * time,
          p.velocity.z * time,
        )
        dummy.rotation.set(p.spin.x * time, p.spin.y * time, p.spin.z * time)
        const shrink = 1 - pt
        dummy.scale.setScalar(p.scale * shrink)
        dummy.updateMatrix()
        particlesRef.current!.setMatrixAt(i, dummy.matrix)
      })
      particlesRef.current.instanceMatrix.needsUpdate = true
      particleMaterial.opacity = 1 - pt
    }

    if (t >= 1 && pt >= 1) {
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
      <instancedMesh ref={particlesRef} args={[undefined, undefined, PARTICLE_COUNT]} material={particleMaterial}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
    </group>
  )
}
