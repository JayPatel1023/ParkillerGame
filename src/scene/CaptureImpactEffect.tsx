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

// Requested again, directly, alongside the win celebration: "우승했을때와... 상대방의 말을
// 먹었을때의 멋진 3D효과" (a cooler 3D effect for both winning and eating an opponent's piece) -
// the plain colored debris chips above read as impact, but not as anything magical, next to how
// far DiceRollGlow.tsx's own roll effect has come (soft additive sparkle sprites and real stars
// instead of flat shapes). Layers a second particle family - real five-pointed stars plus soft
// round glints, both additive-blended so they actually brighten rather than just tint - on top of
// the existing chips rather than replacing them, so the "something was knocked apart" read stays
// intact and this only adds the sparkle a plain box chip can't give on its own.
// Two families rather than one, the same split DiceRollGlow.tsx settled on: a handful of bright
// star accents plus a larger scatter of small soft glints, since one shape/size repeated many
// times reads as static "confetti" rather than a magical sparkle.
const STAR_COUNT = 6
const DOT_COUNT = 12
// A little longer than the debris chips' own PARTICLE_LIFETIME - the sparkle dust should still be
// twinkling out for a beat after the physical debris has already finished falling, the same
// "don't let every element finish in lockstep" reasoning PARTICLE_LIFETIME's own comment gives.
const SPARK_LIFETIME = 0.78

interface Particle {
  velocity: THREE.Vector3
  spin: THREE.Vector3
  scale: number
}

interface Spark {
  velocity: THREE.Vector3
  size: number
  twinkleSpeed: number
  twinklePhase: number
}

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

// A soft round glint - fades to transparent at its own edge, so it reads as a glowing point of
// light rather than a hard-edged disc once additive-blended over the burst.
function createSoftDotTexture(): THREE.Texture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.45, 'rgba(255,255,255,0.7)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
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
  const starsRef = useRef<InstancedMesh>(null)
  const dotsRef = useRef<InstancedMesh>(null)

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

  // Sparks fly a bit slower/wider than the debris chips and barely fall (a tenth of GRAVITY) - they
  // read as light drifting sparkle, not more physical debris, which is what the chips already cover.
  const makeSparks = (count: number, sizeMin: number, sizeRange: number): Spark[] =>
    Array.from({ length: count }, () => {
      const angle = Math.random() * Math.PI * 2
      const speed = 0.5 + Math.random() * 0.9
      return {
        velocity: new THREE.Vector3(Math.cos(angle) * speed, 0.9 + Math.random() * 1.1, Math.sin(angle) * speed),
        size: sizeMin + Math.random() * sizeRange,
        twinkleSpeed: 6 + Math.random() * 6,
        twinklePhase: Math.random() * Math.PI * 2,
      }
    })
  const starSparks = useMemo(() => makeSparks(STAR_COUNT, 0.05, 0.035), [])
  const dotSparks = useMemo(() => makeSparks(DOT_COUNT, 0.028, 0.026), [])

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const particleMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }), [color])
  const starGeometry = useMemo(() => createStarGeometry(), [])
  const dotTexture = useMemo(() => createSoftDotTexture(), [])
  const starMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#fff4d6',
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  const dotMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: dotTexture,
        color,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [color, dotTexture],
  )

  const updateSparkInstances = (mesh: InstancedMesh | null, sparks: Spark[], st: number, time: number) => {
    if (!mesh) return
    sparks.forEach((s, i) => {
      dummy.position.set(s.velocity.x * time, s.velocity.y * time - 0.5 * GRAVITY * 0.1 * time * time, s.velocity.z * time)
      dummy.rotation.set(0, 0, s.twinklePhase + time * s.twinkleSpeed * 0.3)
      const twinkle = 0.55 + 0.45 * Math.sin(time * s.twinkleSpeed + s.twinklePhase)
      const shrink = 1 - st
      dummy.scale.setScalar(s.size * shrink * Math.max(0.15, twinkle))
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }

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

    const st = Math.min(1, elapsedRef.current / SPARK_LIFETIME)
    const sparkTime = st * SPARK_LIFETIME
    updateSparkInstances(starsRef.current, starSparks, st, sparkTime)
    updateSparkInstances(dotsRef.current, dotSparks, st, sparkTime)
    starMaterial.opacity = 1 - st
    dotMaterial.opacity = 1 - st

    if (t >= 1 && pt >= 1 && st >= 1) {
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
      <instancedMesh ref={starsRef} args={[starGeometry, starMaterial, STAR_COUNT]} />
      <instancedMesh ref={dotsRef} args={[undefined, undefined, DOT_COUNT]} material={dotMaterial}>
        <planeGeometry args={[1, 1]} />
      </instancedMesh>
    </group>
  )
}
