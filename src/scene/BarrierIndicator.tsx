import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Group, Mesh } from 'three'

// Reported directly ("장벽이있다는 효과같은것이 없으니 오락하는사람들이 모를수있다" - there's no
// effect showing a barrier exists, so players might not notice): two pieces sharing a square
// already rendered spread apart (see BoardScene's own STACK_OFFSETS), but nothing distinguished
// "this is a real barrier blocking the path" from "two pieces just happen to be near each other".
// A persistent ambient effect reads as "something special is happening here" without a tooltip.
//
// Rebuilt a third time - reported directly, with a screenshot, as not liking the style at all
// ("장벽의 스타일이 전혀 맘에들지않는다"), asking specifically for a spiral of star-like lights
// rising and turning ("별처럼 빛들이 빙빙돌아가면서 우로올라가는 스타일"), clear but not busy
// ("눈에 알리면서도 번거롭지않는"), and polished ("세련되게" - "이 게임은 잘 만들어야한다").
// The previous pass's solid amber cone (added purely to stay visible from the game's own shallow
// camera angle - see the git history on this file) read as a crude spotlight/traffic-cone shape,
// not a magical effect, and the double counter-rotating ring plus the cone plus the sparkles
// together were three separate moving elements competing for attention at once - the definition of
// "번거롭다" (busy/cluttered). This version drops the cone and the second ring entirely: a single
// quiet glow + ring marks the exact square, and a slow-turning double helix of real five-pointed
// stars (procedural geometry, not a texture) does the actual "something is here" signaling - its
// own height, not a separate solid shape, is what stays legible from any camera angle, exactly
// like the cone was doing but as part of the same effect instead of a bolted-on extra one.
const RING_COLOR = '#e8a33d'
const GLOW_COLOR = '#f5b94a'
const RING_SPIN_SPEED = 0.35 // slow, ambient - this sits for multiple turns, not "act now"
const RING_PULSE_SPEED = 1.1
const RING_BASE_OPACITY = 0.55
const RING_PULSE_AMPLITUDE = 0.2
const GLOW_BASE_OPACITY = 0.18
const GLOW_PULSE_AMPLITUDE = 0.08

// Two strands, each STARS_PER_STRAND stars evenly spaced along its own rise so the helix never
// looks empty partway up, wound STRAND_TURNS times around the square by the top of the rise - "빙빙
// 돌아가면서" (turning as it goes) needs an actual multi-turn spiral, not just one lazy arc.
const STRAND_COUNT = 2
const STARS_PER_STRAND = 5
const STRAND_TURNS = 1.4
const STAR_COLOR_WARM = '#ffcf6b'
const STAR_COLOR_PALE = '#fff2c9'
const ORBIT_SPEED = 0.5
// Reported directly, checked live: the first pass's rise (2.4x tileSize, matching the old solid
// cone's own height) spread only 8 stars thin enough over that column to read as isolated floating
// points rather than a connected helix. Pulled in - stars don't need a cone's own height to stay
// individually visible, just to sit close enough together that the eye connects them into one
// continuous spiral.
const RISE_HEIGHT_FACTOR = 1.6 // multiplied by tileSize
const CYCLE_SECONDS = 3.6
// Individual size/twinkle jitter, keyed off each star's own index so neighbors don't pulse in
// lockstep - a real starfield never twinkles in unison.
const TWINKLE_SPEED_BASE = 1.6
const TWINKLE_SPEED_JITTER = 0.9

interface StarSpec {
  strandAngle: number
  cyclePhase: number
  size: number
  color: string
  twinkleSpeed: number
  twinklePhase: number
}

// A real 5-pointed star polygon (alternating outer/inner radius vertices), not a texture or a
// sprite - built once and shared by every star instance on the board, cheap enough that a handful
// of simultaneous barriers costs nothing extra.
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

export function BarrierIndicator({ position, tileSize }: { position: [number, number, number]; tileSize: number }) {
  const groupRef = useRef<Group>(null)
  const ringRef = useRef<Mesh>(null)
  const glowRef = useRef<Mesh>(null)
  const starRefs = useRef<(Mesh | null)[]>([])
  const elapsedRef = useRef(0)

  // Sized as a fraction of this board's own tile size, like STACK_OFFSETS itself, so the ring
  // reads at a consistent proportion of the tile on every board instead of a fixed world-unit guess.
  const ringRadius = tileSize * 0.44
  const ringWidth = tileSize * 0.05
  const starOrbitRadius = tileSize * 0.3
  const riseHeight = tileSize * RISE_HEIGHT_FACTOR

  const starGeometry = useMemo(() => createStarGeometry(), [])

  const stars = useMemo<StarSpec[]>(() => {
    const list: StarSpec[] = []
    for (let strand = 0; strand < STRAND_COUNT; strand++) {
      const strandAngle = (strand / STRAND_COUNT) * Math.PI * 2
      for (let i = 0; i < STARS_PER_STRAND; i++) {
        const seed = strand * STARS_PER_STRAND + i
        list.push({
          strandAngle,
          cyclePhase: (i / STARS_PER_STRAND) * CYCLE_SECONDS,
          size: tileSize * (0.045 + (seed % 3) * 0.012),
          color: seed % 2 === 0 ? STAR_COLOR_WARM : STAR_COLOR_PALE,
          twinkleSpeed: TWINKLE_SPEED_BASE + (seed % 4) * (TWINKLE_SPEED_JITTER / 4),
          twinklePhase: (seed / (STRAND_COUNT * STARS_PER_STRAND)) * Math.PI * 2,
        })
      }
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileSize])

  useFrame(({ camera }, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1)
    elapsedRef.current += delta
    const t = elapsedRef.current
    const pulse = Math.sin(t * RING_PULSE_SPEED) * 0.5 + 0.5

    if (ringRef.current) {
      ringRef.current.rotation.z += delta * RING_SPIN_SPEED
      ;(ringRef.current.material as THREE.MeshBasicMaterial).opacity = RING_BASE_OPACITY + pulse * RING_PULSE_AMPLITUDE
    }
    if (glowRef.current) {
      const glowMat = glowRef.current.material as THREE.MeshBasicMaterial
      glowMat.opacity = GLOW_BASE_OPACITY + pulse * GLOW_PULSE_AMPLITUDE
      const s = 1 + pulse * 0.06
      glowRef.current.scale.set(s, s, 1)
    }

    stars.forEach((s, i) => {
      const mesh = starRefs.current[i]
      if (!mesh) return
      const cycleT = ((t + s.cyclePhase) % CYCLE_SECONDS) / CYCLE_SECONDS
      // Winds STRAND_TURNS full turns around the square over the course of one rise - the actual
      // "spinning while climbing" spiral, not just an orbit with height tacked on separately.
      const angle = s.strandAngle + cycleT * Math.PI * 2 * STRAND_TURNS + t * ORBIT_SPEED
      const height = cycleT * riseHeight
      mesh.position.set(Math.cos(angle) * starOrbitRadius, height, Math.sin(angle) * starOrbitRadius)
      // Always faces the camera (a manual billboard) - a flat star polygon lying at an arbitrary
      // spiral angle would foreshorten into a sliver from the game's own angled default view
      // otherwise, exactly the shrink-to-a-thin-line problem the old solid cone had to work around.
      mesh.quaternion.copy(camera.quaternion)

      const twinkle = Math.sin(t * s.twinkleSpeed + s.twinklePhase) * 0.5 + 0.5
      const scale = s.size * (0.75 + twinkle * 0.45)
      mesh.scale.setScalar(scale)

      // Fades in quickly at the base, holds bright through the middle of the rise, fades out near
      // the top - drifting into and back out of existence rather than a hard pop/vanish.
      const fade = cycleT < 0.12 ? cycleT / 0.12 : cycleT > 0.8 ? (1 - cycleT) / 0.2 : 1
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(0, fade) * (0.65 + twinkle * 0.35)
    })
  })

  return (
    <group ref={groupRef} position={position}>
      {/* Soft glow disc under everything else - reads at a glance even before the eye resolves the
          ring's own thin geometry, especially from a shallow top-down camera angle. */}
      <mesh ref={glowRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
        <circleGeometry args={[ringRadius * 1.3, 32]} />
        <meshBasicMaterial color={GLOW_COLOR} transparent opacity={GLOW_BASE_OPACITY} depthWrite={false} />
      </mesh>
      {/* Single quiet ring marks the exact square - a second counter-rotating ring read as one
          moving element too many once the star helix itself carries the "something is here"
          signal, reported directly as feeling busy rather than sophisticated. */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <ringGeometry args={[ringRadius - ringWidth, ringRadius, 48]} />
        <meshBasicMaterial color={RING_COLOR} transparent opacity={RING_BASE_OPACITY} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {stars.map((s, i) => (
        <mesh key={i} ref={(el) => (starRefs.current[i] = el)} geometry={starGeometry}>
          <meshBasicMaterial color={s.color} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}
