import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { InstancedMesh, Mesh } from 'three'
import { PIECE_BASE_RADIUS } from './PieceMesh'
import { BASE_HEIGHT } from './boardGeometry'

// Requested directly, alongside the capture fanfare (see CaptureImpactEffect.tsx's own recent
// comment): "우승했을때... 멋진 3D효과" (a cooler 3D effect for the moment someone actually wins the
// whole game). Before this, winning only got the screen-space Confetti.tsx overlay - a real, but
// flat, 2D effect that plays identically no matter which player won. This is a genuine in-Canvas
// burst at the board's own center hub (the natural focal point every player is already looking at),
// modeled on FinishCelebrationEffect's ring+flash+rising-sparkle shape (a single piece finishing is
// the closest existing "arrival" moment) but scaled up and held far longer - winning the whole game
// is the single biggest moment in a match, and needs to read as bigger than any one piece's own
// finish, not a copy of it at the same size.
const RING_HEIGHT = BASE_HEIGHT + 0.02

const CELEBRATION_DURATION = 2.0 // seconds - a full deliberate victory beat, not a quick cue.
const FLASH_DURATION = CELEBRATION_DURATION * 0.22
const RING_END_SCALE = 16
const RING2_END_SCALE = RING_END_SCALE * 0.68
const RING3_END_SCALE = RING_END_SCALE * 0.42
const FLASH_END_SCALE = 5

const SPARKLE_COUNT = 40
const SPARKLE_RISE_HEIGHT = PIECE_BASE_RADIUS * 22
const GOLD_TONES = ['#ffe08a', '#ffd24a', '#fff4c2', '#ffb347']

const STAR_COUNT = 14
const STAR_RISE_HEIGHT = PIECE_BASE_RADIUS * 16

function createStarGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape()
  const points = 5
  const outerRadius = 1
  const innerRadius = 0.42
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius
    const angle = (i * Math.PI) / points - Math.PI / 2
    const x = Math.cos(angle) * r
    const y = Math.sin(angle) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
}

interface Sparkle {
  angle: number
  radius: number
  riseSpeed: number
  spin: THREE.Vector3
  scale: number
}

interface Star {
  angle: number
  radius: number
  riseSpeed: number
  spinSpeed: number
  scale: number
  twinklePhase: number
}

interface WinCelebrationEffectProps {
  position: [number, number, number]
  color: string
  onComplete: () => void
}

/** A one-shot grand burst at the board's own center hub - three overlapping expanding rings, a
 * bright flash, a wide cone of rising golden sparkle motes, and a slower outer ring of rising,
 * twinkling stars in the winning player's own color - marking the single moment a player actually
 * wins the whole game, distinct from (and bigger than) any one piece's own finish celebration. */
export function WinCelebrationEffect({ position, color, onComplete }: WinCelebrationEffectProps) {
  const elapsedRef = useRef(0)
  const doneRef = useRef(false)
  const ringRef = useRef<Mesh>(null)
  const ring2Ref = useRef<Mesh>(null)
  const ring3Ref = useRef<Mesh>(null)
  const flashRef = useRef<Mesh>(null)
  const sparklesRef = useRef<InstancedMesh>(null)
  const starsRef = useRef<InstancedMesh>(null)

  const sparkles = useMemo<Sparkle[]>(
    () =>
      Array.from({ length: SPARKLE_COUNT }, (_, i) => ({
        angle: (i / SPARKLE_COUNT) * Math.PI * 2 + Math.random() * 0.4,
        radius: PIECE_BASE_RADIUS * (0.8 + Math.random() * 4.2),
        riseSpeed: 0.55 + Math.random() * 0.5,
        spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        scale: PIECE_BASE_RADIUS * (0.18 + Math.random() * 0.16),
      })),
    [],
  )

  const stars = useMemo<Star[]>(
    () =>
      Array.from({ length: STAR_COUNT }, (_, i) => ({
        angle: (i / STAR_COUNT) * Math.PI * 2 + Math.random() * 0.3,
        radius: PIECE_BASE_RADIUS * (3.5 + Math.random() * 3),
        riseSpeed: 0.4 + Math.random() * 0.35,
        spinSpeed: 1.5 + Math.random() * 2,
        scale: PIECE_BASE_RADIUS * (0.32 + Math.random() * 0.2),
        twinklePhase: Math.random() * Math.PI * 2,
      })),
    [],
  )

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const dummyColor = useMemo(() => new THREE.Color(), [])
  const starGeometry = useMemo(() => createStarGeometry(), [])
  const starMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }),
    [color],
  )

  // Per-instance sparkle color, set once on mount - same reasoning as FinishCelebrationEffect's own
  // identical effect: color never changes over a sparkle's lifetime, only opacity/scale (driven
  // every frame below), so this doesn't belong in the useFrame loop.
  useEffect(() => {
    const mesh = sparklesRef.current
    if (!mesh) return
    sparkles.forEach((_, i) => {
      dummyColor.set(GOLD_TONES[i % GOLD_TONES.length])
      mesh.setColorAt(i, dummyColor)
    })
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((_, delta) => {
    if (doneRef.current) return
    elapsedRef.current += delta
    const t = Math.min(1, elapsedRef.current / CELEBRATION_DURATION)
    const eased = 1 - (1 - t) * (1 - t)

    if (ringRef.current) {
      ringRef.current.scale.setScalar(1 + eased * (RING_END_SCALE - 1))
      ;(ringRef.current.material as THREE.MeshBasicMaterial).opacity = 1 - t
    }
    if (ring2Ref.current) {
      const t2 = Math.min(1, Math.max(0, elapsedRef.current - CELEBRATION_DURATION * 0.12) / (CELEBRATION_DURATION * 0.88))
      const eased2 = 1 - (1 - t2) * (1 - t2)
      ring2Ref.current.scale.setScalar(1 + eased2 * (RING2_END_SCALE - 1))
      ;(ring2Ref.current.material as THREE.MeshBasicMaterial).opacity = (1 - t2) * 0.85
    }
    if (ring3Ref.current) {
      // A third, further-delayed and smaller-ending ring - three overlapping waves read as a
      // genuine swell of successive pulses rather than one ring or two rings scaling in lockstep.
      const t3 = Math.min(1, Math.max(0, elapsedRef.current - CELEBRATION_DURATION * 0.26) / (CELEBRATION_DURATION * 0.74))
      const eased3 = 1 - (1 - t3) * (1 - t3)
      ring3Ref.current.scale.setScalar(1 + eased3 * (RING3_END_SCALE - 1))
      ;(ring3Ref.current.material as THREE.MeshBasicMaterial).opacity = (1 - t3) * 0.8
    }
    if (flashRef.current) {
      const flashT = Math.min(1, elapsedRef.current / FLASH_DURATION)
      flashRef.current.scale.setScalar(1 + flashT * (FLASH_END_SCALE - 1))
      ;(flashRef.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - flashT)
    }

    if (sparklesRef.current) {
      sparkles.forEach((s, i) => {
        const life = Math.min(1, (elapsedRef.current * s.riseSpeed) / CELEBRATION_DURATION)
        const height = life * SPARKLE_RISE_HEIGHT
        const outward = s.radius * (0.4 + life * 1.1)
        dummy.position.set(Math.cos(s.angle) * outward, height, Math.sin(s.angle) * outward)
        dummy.rotation.set(life * s.spin.x, life * s.spin.y, life * s.spin.z)
        const fade = life < 0.1 ? life / 0.1 : life > 0.65 ? Math.max(0, 1 - (life - 0.65) / 0.35) : 1
        dummy.scale.setScalar(s.scale * (0.6 + fade * 0.4))
        dummy.updateMatrix()
        sparklesRef.current!.setMatrixAt(i, dummy.matrix)
      })
      sparklesRef.current.instanceMatrix.needsUpdate = true
    }

    if (starsRef.current) {
      stars.forEach((s, i) => {
        const life = Math.min(1, (elapsedRef.current * s.riseSpeed) / CELEBRATION_DURATION)
        const height = life * STAR_RISE_HEIGHT
        const outward = s.radius * (0.6 + life * 0.8)
        dummy.position.set(Math.cos(s.angle) * outward, height, Math.sin(s.angle) * outward)
        dummy.quaternion.identity()
        dummy.rotation.set(0, 0, s.twinklePhase + elapsedRef.current * s.spinSpeed)
        const twinkle = 0.6 + 0.4 * Math.sin(elapsedRef.current * 5 + s.twinklePhase)
        const fade = life < 0.12 ? life / 0.12 : life > 0.6 ? Math.max(0, 1 - (life - 0.6) / 0.4) : 1
        dummy.scale.setScalar(s.scale * fade * twinkle)
        dummy.updateMatrix()
        starsRef.current!.setMatrixAt(i, dummy.matrix)
      })
      starsRef.current.instanceMatrix.needsUpdate = true
    }

    if (t >= 1) {
      doneRef.current = true
      onComplete()
    }
  })

  return (
    <group position={position}>
      <mesh ref={flashRef} position={[0, RING_HEIGHT, 0]}>
        <sphereGeometry args={[PIECE_BASE_RADIUS * 0.7, 16, 16]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={1} depthWrite={false} />
      </mesh>
      <mesh ref={ringRef} position={[0, RING_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PIECE_BASE_RADIUS * 0.65, PIECE_BASE_RADIUS * 1, 48]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={ring2Ref} position={[0, RING_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PIECE_BASE_RADIUS * 0.5, PIECE_BASE_RADIUS * 0.72, 48]} />
        <meshBasicMaterial color="#ffe9b0" transparent opacity={1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={ring3Ref} position={[0, RING_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PIECE_BASE_RADIUS * 0.4, PIECE_BASE_RADIUS * 0.58, 48]} />
        <meshBasicMaterial color={color} transparent opacity={1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <instancedMesh ref={sparklesRef} args={[undefined, undefined, SPARKLE_COUNT]}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial transparent opacity={0.95} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={starsRef} args={[starGeometry, starMaterial, STAR_COUNT]} />
    </group>
  )
}
