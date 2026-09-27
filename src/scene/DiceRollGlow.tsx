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
const FADE_SECONDS = 0.18
const TWINKLE_SPEED_BASE = 3.2
const TWINKLE_SPEED_JITTER = 1.6

// Reported directly, with a screenshot: the handful of stars were too big and just orbited in a
// flat circle - "너무 크다... 작게 많이... 금빛이 뿜어져 나오는것처럼... 오직 돌아가는 형식으로만
// 말고" (too big - make them small and numerous, like gold light spraying out, not just orbiting).
// Replaced the fixed-radius orbit with a continuous burst: many more, much smaller sparks, each on
// its own staggered cycle from the center out past the ring before fading and looping back to the
// center to burst again - a fountain, not a single ring of ornaments. Real 3D depth (not just a
// flat billboard plane) comes from each spark's own random *local* z offset (the group's own local
// z, once billboarded to face the camera, points straight at/away from the viewer) - some sparks
// read as popping out toward the camera mid-burst, others recede, instead of every star living on
// one flat disc.
const SPARK_COUNT = 26
const BURST_CYCLE_SECONDS = 1.1
// How far past the ring's own radius a spark travels before it fades out and loops - the "bursting
// past the halo" look, not stopping exactly at the ring's own edge.
const BURST_OVERSHOOT = 1.35

interface StarSpec {
  baseAngle: number
  angleDrift: number
  spawnPhase: number
  depthOffset: number
  size: number
  color: string
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
  const cameraForwardRef = useRef(new THREE.Vector3())

  const orbitRadius = radius * 0.78

  const starGeometry = useMemo(() => createStarGeometry(), [])
  useEffect(() => () => starGeometry.dispose(), [starGeometry])

  const stars = useMemo<StarSpec[]>(
    () =>
      Array.from({ length: SPARK_COUNT }, (_, i) => {
        // A pure index-based angle would leave every burst cycle re-using the exact same set of
        // directions - deterministic jitter (seeded off the index, not Math.random(), so this
        // stays stable across re-renders) breaks that into a real spray instead of spokes on a
        // wheel.
        const seed = i / SPARK_COUNT
        return {
          baseAngle: seed * Math.PI * 2,
          angleDrift: Math.sin(i * 12.9898) * 0.8,
          spawnPhase: seed * BURST_CYCLE_SECONDS,
          depthOffset: Math.sin(i * 78.233) * radius * 0.3,
          size: radius * (0.09 + (i % 5) * 0.014),
          color: i % 2 === 0 ? STAR_COLOR_WARM : STAR_COLOR_PALE,
          twinkleSpeed: TWINKLE_SPEED_BASE + (i % 4) * (TWINKLE_SPEED_JITTER / 4),
          twinklePhase: seed * Math.PI * 2,
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }),
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

    // Camera-relative, computed once per frame and reused for every spark's own depth pop below -
    // see SPARK_COUNT's own doc comment for why this (not a per-star fixed z) is what gives real
    // 3D depth rather than every spark living on one flat billboard plane.
    const cameraForward = cameraForwardRef.current.set(0, 0, -1).applyQuaternion(camera.quaternion)

    stars.forEach((s, i) => {
      const mesh = starRefs.current[i]
      if (!mesh) return
      // Each spark runs its own lap of the burst cycle, offset by its own spawnPhase so they
      // erupt in a continuous staggered wave rather than all bursting and resetting in lockstep.
      const cycleT = ((t + s.spawnPhase) % BURST_CYCLE_SECONDS) / BURST_CYCLE_SECONDS
      const angle = s.baseAngle + s.angleDrift * cycleT + t * 0.6
      const dist = cycleT * orbitRadius * BURST_OVERSHOOT
      const bob = Math.sin(t * 1.8 + s.twinklePhase) * radius * 0.05
      // Peaks mid-burst and returns to zero at both ends, so the pop-toward/recede-from-camera
      // read happens mid-flight, not as a jump at spawn or despawn.
      const depthPop = s.depthOffset * Math.sin(cycleT * Math.PI)
      // Rises as it bursts outward, not a flat height for the whole flight - confirmed directly
      // that a flat height left most of each spark's own flight hidden behind the dice themselves
      // (screenshotted mid-roll: visible only in the ~2 frames out of 15 sampled where a spark's
      // own position happened to clear a die's own silhouette from the camera's angle).
      const height = radius * (0.22 + cycleT * 0.55) + bob

      mesh.position.set(
        Math.cos(angle) * dist + cameraForward.x * depthPop,
        height,
        Math.sin(angle) * dist + cameraForward.z * depthPop,
      )
      // Billboarded so a flat star polygon reads clearly from the game's own shallow default
      // camera angle instead of foreshortening into a sliver - same reasoning as
      // BarrierIndicator.tsx's own star billboarding.
      mesh.quaternion.copy(camera.quaternion)

      // Fades in fast right at the burst's own center, holds through the middle of its flight,
      // fades out again before it reaches BURST_OVERSHOOT - a spark dissipating, not popping in
      // or vanishing at a hard edge.
      const fade = cycleT < 0.12 ? cycleT / 0.12 : cycleT > 0.65 ? Math.max(0, 1 - (cycleT - 0.65) / 0.35) : 1
      const twinkle = Math.sin(t * s.twinkleSpeed + s.twinklePhase) * 0.5 + 0.5
      mesh.scale.setScalar(s.size * (0.7 + cycleT * 0.5) * (0.75 + twinkle * 0.45))
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.opacity = fade * (0.7 + twinkle * 0.3) * envelope
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
          <meshBasicMaterial
            color={s.color}
            transparent
            opacity={0}
            depthWrite={false}
            side={THREE.DoubleSide}
            // Additive so overlapping sparks and the glow underneath actually brighten together -
            // requested directly ("금빛이 뿜어져나오는것처럼" - like gold light spraying out), which
            // plain alpha blending (the ring/glow discs' own, still correct for a flat wash of
            // color) can't read as on its own.
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  )
}
