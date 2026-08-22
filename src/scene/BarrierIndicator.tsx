import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Group, Mesh } from 'three'

// Reported directly ("장벽이있다는 효과같은것이 없으니 오락하는사람들이 모를수있다" - there's no
// effect showing a barrier exists, so players might not notice): two pieces sharing a square
// already rendered spread apart (see BoardScene's own STACK_OFFSETS), but nothing distinguished
// "this is a real barrier blocking the path" from "two pieces just happen to be near each other" -
// the same visual regardless of whether it actually matters to the current player's move. A
// persistent glowing ward-circle plus rising sparkle motes reads as "something special is
// happening here" without needing a tooltip or text label - "동화적 효과" (a fairy-tale-like
// effect), the same request that produced RewardBurst's own spark language, applied here as an
// ambient/continuous effect instead of a one-shot celebration since a barrier persists across
// turns, not just an instant.
//
// First pass (soft single ring + 3 small orbiting motes) read as too subtle once actually checked
// live at real board scale - reported directly, asking for something that catches the eye, "자그마한
// 세부도 놓치지말고 꼼꼼하게" (don't miss even the small details, be thorough). Rebuilt with more
// visual weight throughout: a soft glow disc under the ring (reads at a glance even before the eye
// resolves the ring itself), a brighter counter-rotating double ring (matching PieceMesh's own
// "selectable" ring technique, just amber/bronze instead of pure gold so the two don't read as the
// same cue when a barrier piece is also selectable), and more, bigger sparkles that actually rise
// and fade like rising magic dust instead of just bobbing in place.
const RING_OUTER_COLOR = '#e8a33d'
const RING_INNER_COLOR = '#ffd98a'
const GLOW_COLOR = '#f5b94a'
const RING_OUTER_SPIN_SPEED = 0.55 // radians/sec - slower than PieceMesh's own selectable ring, a
const RING_INNER_SPIN_SPEED = -0.8 // calmer, more ambient presence befitting something that sits
// there for multiple turns, not a "act now" cue - counter-rotating pair still reads as alive.
const RING_PULSE_SPEED = 1.3
const RING_BASE_OPACITY = 0.75
const RING_PULSE_AMPLITUDE = 0.25
const GLOW_BASE_OPACITY = 0.22
const GLOW_PULSE_AMPLITUDE = 0.1

const SPARKLE_COUNT = 6
const SPARKLE_COLOR = '#fff2c9'
const SPARKLE_ORBIT_SPEED = 0.6
// Each sparkle rises from the ground and fades near the top of its own rise, then resets - a
// continuous "magic dust drifting up" cycle rather than a fixed bob in place.
const SPARKLE_RISE_HEIGHT = 0.32
const SPARKLE_CYCLE_SECONDS = 2.6

interface SparkleSpec {
  radius: number
  angleOffset: number
  cyclePhase: number
  size: number
}

export function BarrierIndicator({ position, tileSize }: { position: [number, number, number]; tileSize: number }) {
  const groupRef = useRef<Group>(null)
  const outerRingRef = useRef<Mesh>(null)
  const innerRingRef = useRef<Mesh>(null)
  const glowRef = useRef<Mesh>(null)
  const sparkleRefs = useRef<(Mesh | null)[]>([])
  const elapsedRef = useRef(0)

  // Sized as a fraction of this board's own tile size (like STACK_OFFSETS itself), so the ring
  // reads at a consistent proportion of the tile on every board instead of a fixed world-unit
  // guess that would over/undersize on a board with much bigger or smaller squares.
  const ringRadius = tileSize * 0.46
  const ringWidth = tileSize * 0.06

  const sparkles = useMemo<SparkleSpec[]>(
    () =>
      Array.from({ length: SPARKLE_COUNT }, (_, i) => ({
        radius: ringRadius * (0.55 + (i % 3) * 0.18),
        angleOffset: (i / SPARKLE_COUNT) * Math.PI * 2,
        cyclePhase: (i / SPARKLE_COUNT) * SPARKLE_CYCLE_SECONDS,
        size: tileSize * (0.022 + (i % 3) * 0.006),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ringRadius, tileSize],
  )

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1)
    elapsedRef.current += delta
    const t = elapsedRef.current
    const pulse = Math.sin(t * RING_PULSE_SPEED) * 0.5 + 0.5

    if (outerRingRef.current) {
      outerRingRef.current.rotation.z += delta * RING_OUTER_SPIN_SPEED
      ;(outerRingRef.current.material as THREE.MeshBasicMaterial).opacity = RING_BASE_OPACITY + pulse * RING_PULSE_AMPLITUDE
    }
    if (innerRingRef.current) {
      innerRingRef.current.rotation.z += delta * RING_INNER_SPIN_SPEED
      ;(innerRingRef.current.material as THREE.MeshBasicMaterial).opacity = RING_BASE_OPACITY * 0.7 + pulse * RING_PULSE_AMPLITUDE
    }
    if (glowRef.current) {
      const glowMat = glowRef.current.material as THREE.MeshBasicMaterial
      glowMat.opacity = GLOW_BASE_OPACITY + pulse * GLOW_PULSE_AMPLITUDE
      const s = 1 + pulse * 0.08
      glowRef.current.scale.set(s, s, 1)
    }

    sparkles.forEach((s, i) => {
      const mesh = sparkleRefs.current[i]
      if (!mesh) return
      const cycleT = ((t + s.cyclePhase) % SPARKLE_CYCLE_SECONDS) / SPARKLE_CYCLE_SECONDS
      const angle = t * SPARKLE_ORBIT_SPEED + s.angleOffset
      const height = cycleT * SPARKLE_RISE_HEIGHT
      mesh.position.set(Math.cos(angle) * s.radius, height, Math.sin(angle) * s.radius)
      // Fades in quickly at the base, holds bright through the middle of the rise, fades out near
      // the top - reads as drifting into and back out of existence, not a hard pop/vanish.
      const fade = cycleT < 0.15 ? cycleT / 0.15 : cycleT > 0.75 ? (1 - cycleT) / 0.25 : 1
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, fade) * 0.9
    })
  })

  return (
    <group ref={groupRef} position={position}>
      {/* Soft glow disc under everything else - reads at a glance even before the eye resolves
          the ring's own thin geometry, especially important at a shallow top-down camera angle. */}
      <mesh ref={glowRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <circleGeometry args={[ringRadius * 1.35, 32]} />
        <meshBasicMaterial color={GLOW_COLOR} transparent opacity={GLOW_BASE_OPACITY} depthWrite={false} />
      </mesh>
      <mesh ref={outerRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <ringGeometry args={[ringRadius - ringWidth, ringRadius, 48]} />
        <meshBasicMaterial color={RING_OUTER_COLOR} transparent opacity={RING_BASE_OPACITY} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={innerRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.007, 0]}>
        <ringGeometry args={[ringRadius - ringWidth * 2.2, ringRadius - ringWidth * 1.5, 48]} />
        <meshBasicMaterial color={RING_INNER_COLOR} transparent opacity={RING_BASE_OPACITY * 0.7} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {sparkles.map((s, i) => (
        <mesh key={i} ref={(el) => (sparkleRefs.current[i] = el)} position={[s.radius, 0, 0]}>
          <sphereGeometry args={[s.size, 8, 8]} />
          <meshBasicMaterial color={SPARKLE_COLOR} transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}
