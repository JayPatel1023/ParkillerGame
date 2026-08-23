import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { InstancedMesh, Mesh } from 'three'
import { PIECE_BASE_RADIUS } from './PieceMesh'
import { BASE_HEIGHT } from './boardGeometry'

// Diagnosed directly (console-logged the ring's own scale/opacity/worldPosition every frame, since
// screenshots alone made it look like the ring simply never rendered - it turned out to be
// rendering correctly the entire time): the ring's original color choice (gold, matching
// RewardBurst's own warm palette) was rendering directly on top of the finish square's own
// painted-on decorative target ring, already gold/cream in the board art itself - visually
// indistinguishable regardless of the animated ring's own opacity/scale, confirmed by swapping to
// an unmissable magenta/cyan test color and watching it appear perfectly. The exact same class of
// bug as PieceMesh's own selectable-piece cue (see that file's own comment) - a same-toned effect
// disappearing into same-toned board art - not a depth, occlusion, or animation bug at all. Colors
// below are picked to read clearly against this board's warm cream/gold palette instead of
// matching it, the same lesson applied here that fixed the selectable cue.
const RING_HEIGHT = BASE_HEIGHT + 0.015

// Reported directly ("중앙홀에 성공적으로 종착점에 가닿았을때에도 효과를 넣어달라" - add an effect when
// a piece successfully reaches the finish square in the central hall too): a piece that finishes
// just hops into its home-corridor slot like any other move, with nothing marking the moment a
// player actually got a piece all the way home - the biggest single accomplishment for one piece in
// the whole game, otherwise indistinguishable from a routine step. Modeled after
// CaptureImpactEffect's own mount-a-burst-then-self-remove pattern, but deliberately not a copy of
// its look: a capture reads as an impact (debris falling under gravity, the captured piece's own
// color), a finish should read as a triumphant arrival - warm gold/cream tones (matching
// RewardBurst's own FINISH_COLORS, so the on-board effect and the screen-space toast feel like one
// event), a taller and longer-held expanding ring, and particles that RISE like a firework instead
// of falling debris. Sized off PIECE_BASE_RADIUS throughout (not fixed absolute numbers the way an
// earlier version of CaptureImpactEffect did) so this stays correctly proportioned through any
// future piece-size change instead of needing its own separate "still too small" report later.
const CELEBRATION_DURATION = 1.1 // seconds - longer than a capture's quick impact; a finish is
// worth savoring, not just registering.
const FLASH_DURATION = CELEBRATION_DURATION * 0.3
const RING_END_SCALE = 7
const FLASH_END_SCALE = 3

const SPARKLE_COUNT = 22
const SPARKLE_RISE_HEIGHT = PIECE_BASE_RADIUS * 14
const SPARKLE_COLORS = ['#ffe08a', '#ffd24a', '#fff4c2', '#ffb347']

interface Sparkle {
  angle: number
  radius: number
  riseSpeed: number
  spin: THREE.Vector3
  scale: number
}

interface FinishCelebrationEffectProps {
  position: [number, number, number]
  onComplete: () => void
}

/** A one-shot golden burst at the finish hub - an expanding ring, a bright flash, and a cone of
 * rising, fading, multi-colored sparkle motes - marking the moment a piece actually completes its
 * journey home. */
export function FinishCelebrationEffect({ position, onComplete }: FinishCelebrationEffectProps) {
  const elapsedRef = useRef(0)
  const doneRef = useRef(false)
  const ringRef = useRef<Mesh>(null)
  const ring2Ref = useRef<Mesh>(null)
  const flashRef = useRef<Mesh>(null)
  const sparklesRef = useRef<InstancedMesh>(null)

  const sparkles = useMemo<Sparkle[]>(
    () =>
      Array.from({ length: SPARKLE_COUNT }, (_, i) => ({
        angle: (i / SPARKLE_COUNT) * Math.PI * 2 + Math.random() * 0.4,
        radius: PIECE_BASE_RADIUS * (0.6 + Math.random() * 2.2),
        riseSpeed: 0.7 + Math.random() * 0.6,
        spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        scale: PIECE_BASE_RADIUS * (0.16 + Math.random() * 0.14),
      })),
    [],
  )

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const dummyColor = useMemo(() => new THREE.Color(), [])

  // Per-instance color, set once on mount - sparkles don't change color over their lifetime, only
  // opacity/scale (driven every frame below), so this doesn't belong in the useFrame loop.
  useEffect(() => {
    const mesh = sparklesRef.current
    if (!mesh) return
    sparkles.forEach((_, i) => {
      dummyColor.set(SPARKLE_COLORS[i % SPARKLE_COLORS.length])
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
      // A second ring, started slightly delayed and ending smaller - two overlapping expanding
      // waves read as a richer "swell" than one alone, without literally doubling the effect.
      const t2 = Math.min(1, Math.max(0, elapsedRef.current - CELEBRATION_DURATION * 0.15) / (CELEBRATION_DURATION * 0.85))
      const eased2 = 1 - (1 - t2) * (1 - t2)
      ring2Ref.current.scale.setScalar(1 + eased2 * (RING_END_SCALE * 0.6 - 1))
      ;(ring2Ref.current.material as THREE.MeshBasicMaterial).opacity = (1 - t2) * 0.8
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
        const outward = s.radius * (0.4 + life * 0.9)
        dummy.position.set(Math.cos(s.angle) * outward, height, Math.sin(s.angle) * outward)
        dummy.rotation.set(life * s.spin.x, life * s.spin.y, life * s.spin.z)
        // Pops in fast, holds, fades out near the top of its rise - reads as drifting up and
        // twinkling out rather than a hard vanish.
        const fade = life < 0.12 ? life / 0.12 : life > 0.6 ? Math.max(0, 1 - (life - 0.6) / 0.4) : 1
        dummy.scale.setScalar(s.scale * (0.6 + fade * 0.4))
        dummy.updateMatrix()
        sparklesRef.current!.setMatrixAt(i, dummy.matrix)
      })
      sparklesRef.current.instanceMatrix.needsUpdate = true
    }

    if (t >= 1) {
      doneRef.current = true
      onComplete()
    }
  })

  return (
    <group position={position}>
      <mesh ref={flashRef} position={[0, RING_HEIGHT, 0]}>
        <sphereGeometry args={[PIECE_BASE_RADIUS * 0.55, 16, 16]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={1} depthWrite={false} />
      </mesh>
      <mesh ref={ringRef} position={[0, RING_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PIECE_BASE_RADIUS * 0.6, PIECE_BASE_RADIUS * 0.9, 40]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={ring2Ref} position={[0, RING_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[PIECE_BASE_RADIUS * 0.5, PIECE_BASE_RADIUS * 0.68, 40]} />
        <meshBasicMaterial color="#ffe9b0" transparent opacity={1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <instancedMesh ref={sparklesRef} args={[undefined, undefined, SPARKLE_COUNT]}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial transparent opacity={0.95} depthWrite={false} />
      </instancedMesh>
    </group>
  )
}
