import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Group, Mesh } from 'three'

// Requested directly, with a reference image: a glowing gold ring/swirl of light around the three
// dice while they're actually rolling - "휙 3D효과를 넣어줘" (add a 3D whoosh effect). Reuses
// BarrierIndicator.tsx's own established glow+ring+real-five-pointed-star language (procedural
// star geometry, not a texture/sprite) rather than inventing a second "something magical is
// happening" visual vocabulary - same warm gold palette, same construction, adapted from a barrier
// square's own rising double helix to a single ring of stars orbiting at a constant height around
// the dice trio instead (a barrier sits still for multiple turns; a roll lasts under two seconds,
// so there's no room for a multi-turn rise to read as anything but a flat spin here).
//
// Mounted once in BoardScene (not per-die) since the reference shows one shared halo encircling
// all three dice together, not three separate effects - `visible` is BoardScene's own `rolling`
// boolean; this fades itself in/out on that transition rather than being conditionally rendered,
// so the "휙" read as a quick swirl in and back out instead of an abrupt pop/vanish.
const RING_COLOR = '#e8a33d'
const GLOW_COLOR = '#f5b94a'
const RING_SPIN_SPEED = 1.4
const STAR_COLOR_WARM = '#ffcf6b'
const STAR_COLOR_PALE = '#fff2c9'
const STAR_COUNT = 8
const ORBIT_SPEED = 2.6
const FADE_SECONDS = 0.18
const TWINKLE_SPEED_BASE = 3.2
const TWINKLE_SPEED_JITTER = 1.6

interface StarSpec {
  baseAngle: number
  size: number
  color: string
  twinkleSpeed: number
  twinklePhase: number
  bobPhase: number
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

export function DiceRollGlow({ position, radius, visible }: { position: [number, number, number]; radius: number; visible: boolean }) {
  const groupRef = useRef<Group>(null)
  const ringRef = useRef<Mesh>(null)
  const glowRef = useRef<Mesh>(null)
  const starRefs = useRef<(Mesh | null)[]>([])
  const elapsedRef = useRef(0)
  // Tracks time since the last true<->false flip, separately from elapsedRef's own free-running
  // spin/orbit clock - the fade envelope needs to restart at zero on every transition regardless
  // of how long the spin itself has been running, while the spin keeps going smoothly through a
  // fade rather than resetting (which would read as a stutter, not a whoosh).
  const sinceTransitionRef = useRef(0)
  const wasVisibleRef = useRef(visible)

  const orbitRadius = radius * 0.78

  const starGeometry = useMemo(() => createStarGeometry(), [])
  useEffect(() => () => starGeometry.dispose(), [starGeometry])

  const stars = useMemo<StarSpec[]>(
    () =>
      Array.from({ length: STAR_COUNT }, (_, i) => ({
        baseAngle: (i / STAR_COUNT) * Math.PI * 2,
        size: radius * (0.13 + (i % 3) * 0.024),
        color: i % 2 === 0 ? STAR_COLOR_WARM : STAR_COLOR_PALE,
        twinkleSpeed: TWINKLE_SPEED_BASE + (i % 4) * (TWINKLE_SPEED_JITTER / 4),
        twinklePhase: (i / STAR_COUNT) * Math.PI * 2,
        bobPhase: (i / STAR_COUNT) * Math.PI * 2,
        // eslint-disable-next-line react-hooks/exhaustive-deps
      })),
    [radius],
  )

  useFrame(({ camera }, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1)
    elapsedRef.current += delta
    const t = elapsedRef.current

    if (visible !== wasVisibleRef.current) {
      wasVisibleRef.current = visible
      sinceTransitionRef.current = 0
    }
    sinceTransitionRef.current += delta
    const fadeT = Math.min(1, sinceTransitionRef.current / FADE_SECONDS)
    // Eased both ways - a quick swirl-in, then (once `visible` flips false on the settle) an
    // equally quick swirl-out, never a hard cut in either direction.
    const envelope = visible ? fadeT : 1 - fadeT
    if (envelope <= 0 && !visible) {
      if (groupRef.current) groupRef.current.visible = false
      return
    }
    if (groupRef.current) groupRef.current.visible = true

    if (ringRef.current) {
      ringRef.current.rotation.z += delta * RING_SPIN_SPEED
      ;(ringRef.current.material as THREE.MeshBasicMaterial).opacity = 0.85 * envelope
    }
    if (glowRef.current) {
      const glowMat = glowRef.current.material as THREE.MeshBasicMaterial
      glowMat.opacity = 0.4 * envelope
      const s = 0.85 + envelope * 0.15
      glowRef.current.scale.set(s, s, 1)
    }

    stars.forEach((s, i) => {
      const mesh = starRefs.current[i]
      if (!mesh) return
      const angle = s.baseAngle + t * ORBIT_SPEED
      const bob = Math.sin(t * 1.8 + s.bobPhase) * radius * 0.08
      mesh.position.set(Math.cos(angle) * orbitRadius, radius * 0.32 + bob, Math.sin(angle) * orbitRadius)
      // Billboarded so a flat star polygon reads clearly from the game's own shallow default
      // camera angle instead of foreshortening into a sliver - same reasoning as
      // BarrierIndicator.tsx's own star billboarding.
      mesh.quaternion.copy(camera.quaternion)

      const twinkle = Math.sin(t * s.twinkleSpeed + s.twinklePhase) * 0.5 + 0.5
      mesh.scale.setScalar(s.size * (0.75 + twinkle * 0.45))
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.opacity = (0.65 + twinkle * 0.35) * envelope
    })
  })

  return (
    <group ref={groupRef} position={position}>
      <mesh ref={glowRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <circleGeometry args={[radius * 1.15, 32]} />
        <meshBasicMaterial color={GLOW_COLOR} transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <ringGeometry args={[radius * 0.94, radius, 48]} />
        <meshBasicMaterial color={RING_COLOR} transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {stars.map((s, i) => (
        <mesh key={i} ref={(el) => (starRefs.current[i] = el)} geometry={starGeometry}>
          <meshBasicMaterial color={s.color} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}
