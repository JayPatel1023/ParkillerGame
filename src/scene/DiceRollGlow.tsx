import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Group, Mesh } from 'three'

// Requested directly, with a reference image: a magical effect around the three dice while
// they're actually rolling - "휙 3D효과를 넣어줘" (add a 3D whoosh effect).
//
// Reported again, twice, refining what "magical" meant here: first that a handful of large stars
// orbiting in a flat circle should become many small ones bursting outward instead ("작게 많이...
// 금빛이 뿜어져 나오는것처럼"); then, directly pointing at the flat yellow ring/disc underneath the
// burst itself, that the whole thing reads as too flat and too circular - "둥근원으로 하지말고
// 우주계처럼 만들라 너무 형식과 틀에 매이지말고" (don't make it a round circle, make it like a
// cosmic/solar system - don't be bound by rigid form), and to add white light streaks, gold sand,
// and blue starlight specifically. Dropped the flat ring/disc entirely (there is no single "ring
// radius" left in this file - every particle below finds its own place in a real 3D volume around
// the dice, not on one flat plane) and replaced the single gold-star burst with three particle
// families at different orbit radii/tilts/heights: gold sand (small, dense, drifting), blue
// starlight (sparser, twinkling, real five-pointed stars), and white light streaks (elongated,
// oriented along their own direction of travel, sweeping through tilted orbital planes like small
// comets) - a scattered star-cluster/orbit feel instead of a single neat halo.
const FADE_SECONDS = 0.18
const TWINKLE_SPEED_BASE = 3.2
const TWINKLE_SPEED_JITTER = 1.6

const SAND_COUNT = 32
const SAND_COLOR_WARM = '#ffd98a'
const SAND_COLOR_DEEP = '#e8a33d'

const STAR_COUNT = 9
const STAR_COLOR_BRIGHT = '#9fd3ff'
const STAR_COLOR_PALE = '#e4f4ff'

const STREAK_COUNT = 6

interface OrbitParticleSpec {
  orbitRadius: number
  polar: number
  baseAngle: number
  spinSpeed: number
  radiusPhase: number
  size: number
  color: string
  twinkleSpeed: number
  twinklePhase: number
}

interface StreakSpec {
  planeQuat: THREE.Quaternion
  orbitRadius: number
  spawnPhase: number
  speed: number
  length: number
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

// A soft round sprite (white, fading to transparent at the edge) - the gold sand grains tint this
// via their own material color rather than needing a second, differently-shaped geometry.
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
  const texture = new THREE.CanvasTexture(canvas)
  return texture
}

// A horizontal light streak - bright along the center of its own length, fading to transparent at
// both ends and both edges, so a stretched plane using this reads as a beam/comet trail rather
// than a visible rectangle.
function createStreakTexture(): THREE.Texture {
  const w = 128
  const h = 32
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const hg = ctx.createLinearGradient(0, 0, w, 0)
  hg.addColorStop(0, 'rgba(255,255,255,0)')
  hg.addColorStop(0.5, 'rgba(255,255,255,1)')
  hg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hg
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'destination-in'
  const vg = ctx.createLinearGradient(0, 0, 0, h)
  vg.addColorStop(0, 'rgba(255,255,255,0)')
  vg.addColorStop(0.5, 'rgba(255,255,255,1)')
  vg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, w, h)
  const texture = new THREE.CanvasTexture(canvas)
  return texture
}

export function DiceRollGlow({ position, radius, visible }: { position: [number, number, number]; radius: number; visible: boolean }) {
  const groupRef = useRef<Group>(null)
  const sandRefs = useRef<(Mesh | null)[]>([])
  const starRefs = useRef<(Mesh | null)[]>([])
  const streakRefs = useRef<(Mesh | null)[]>([])
  const elapsedRef = useRef(0)
  // Tracks time since the last true<->false flip, separately from elapsedRef's own free-running
  // orbit clock - the fade envelope needs to restart at zero on every transition regardless of how
  // long the orbit itself has been running, while the orbit keeps going smoothly through a fade
  // rather than resetting (which would read as a stutter, not a whoosh).
  const sinceTransitionRef = useRef(0)
  const wasVisibleRef = useRef(visible)
  const scratchRef = useRef({
    pos: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
    zAxis: new THREE.Vector3(0, 0, 1),
    roll: new THREE.Quaternion(),
  })

  const starGeometry = useMemo(() => createStarGeometry(), [])
  const dotTexture = useMemo(() => createSoftDotTexture(), [])
  const streakTexture = useMemo(() => createStreakTexture(), [])
  useEffect(
    () => () => {
      starGeometry.dispose()
      dotTexture.dispose()
      streakTexture.dispose()
    },
    [starGeometry, dotTexture, streakTexture],
  )

  // Gold sand: dense, small, scattered through a real 3D volume around the dice (varying orbit
  // radius AND polar elevation per grain, not one flat ring) - a loose drifting cloud rather than
  // particles confined to a single plane.
  const sand = useMemo<OrbitParticleSpec[]>(
    () =>
      Array.from({ length: SAND_COUNT }, (_, i) => {
        const seed = i / SAND_COUNT
        return {
          orbitRadius: radius * (0.32 + (Math.sin(i * 17.23) * 0.5 + 0.5) * 0.85),
          polar: Math.sin(i * 5.37) * 0.95,
          baseAngle: seed * Math.PI * 2,
          spinSpeed: 0.3 + (i % 5) * 0.09,
          radiusPhase: seed * Math.PI * 2,
          size: radius * (0.05 + (i % 4) * 0.012),
          color: i % 2 === 0 ? SAND_COLOR_WARM : SAND_COLOR_DEEP,
          twinkleSpeed: TWINKLE_SPEED_BASE + (i % 4) * (TWINKLE_SPEED_JITTER / 4),
          twinklePhase: seed * Math.PI * 2,
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }),
    [radius],
  )

  // Blue starlight: sparser and bigger than the sand, its own wider/taller volume so it reads as a
  // separate, deeper layer of light rather than just more sand in a different color.
  const stars = useMemo<OrbitParticleSpec[]>(
    () =>
      Array.from({ length: STAR_COUNT }, (_, i) => {
        const seed = i / STAR_COUNT
        return {
          orbitRadius: radius * (0.5 + (Math.sin(i * 29.7) * 0.5 + 0.5) * 0.75),
          polar: Math.sin(i * 8.1) * 1.15,
          baseAngle: seed * Math.PI * 2,
          spinSpeed: 0.16 + (i % 3) * 0.05,
          radiusPhase: seed * Math.PI * 2,
          size: radius * (0.085 + (i % 3) * 0.018),
          color: i % 2 === 0 ? STAR_COLOR_BRIGHT : STAR_COLOR_PALE,
          twinkleSpeed: TWINKLE_SPEED_BASE * 0.75 + (i % 4) * (TWINKLE_SPEED_JITTER / 4),
          twinklePhase: seed * Math.PI * 2,
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }),
    [radius],
  )

  // White light streaks: each sweeps its own full circle, but that circle's own plane is tilted by
  // a fixed, per-streak quaternion (two axis rotations, seeded off the index) - real orbital planes
  // crossing at different angles through the same volume, the actual "우주계" (solar-system) read,
  // not six copies of the same flat ring.
  const streaks = useMemo<StreakSpec[]>(
    () =>
      Array.from({ length: STREAK_COUNT }, (_, i) => {
        const seed = i / STREAK_COUNT
        const tiltX = Math.sin(i * 13.1) * Math.PI * 0.5
        const tiltZ = Math.cos(i * 47.7) * Math.PI * 0.5
        const planeQuat = new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(1, 0, 0), tiltX)
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tiltZ))
        return {
          planeQuat,
          orbitRadius: radius * (0.85 + (i % 3) * 0.22),
          spawnPhase: seed,
          speed: 0.55 + (i % 4) * 0.12,
          length: radius * (0.42 + (i % 3) * 0.12),
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }),
    [radius],
  )

  useFrame(({ camera }, rawDelta) => {
    const group = groupRef.current
    if (!group) return
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
      group.visible = false
      return
    }
    group.visible = true

    const updateOrbitParticle = (mesh: Mesh | null, p: OrbitParticleSpec) => {
      if (!mesh) return
      const angle = p.baseAngle + t * p.spinSpeed
      const rPulse = 1 + Math.sin(t * 1.3 + p.radiusPhase) * 0.14
      const r = p.orbitRadius * rPulse
      const flat = r * Math.cos(p.polar)
      mesh.position.set(Math.cos(angle) * flat, radius * 0.18 + r * Math.sin(p.polar) * 0.55, Math.sin(angle) * flat)
      // Billboarded so a flat sprite/star polygon reads clearly from any angle instead of
      // foreshortening into a sliver - same reasoning as BarrierIndicator.tsx's own star
      // billboarding.
      mesh.quaternion.copy(camera.quaternion)
      const twinkle = Math.sin(t * p.twinkleSpeed + p.twinklePhase) * 0.5 + 0.5
      mesh.scale.setScalar(p.size * (0.7 + twinkle * 0.5))
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.opacity = (0.55 + twinkle * 0.45) * envelope
    }

    sand.forEach((p, i) => updateOrbitParticle(sandRefs.current[i], p))
    stars.forEach((p, i) => updateOrbitParticle(starRefs.current[i], p))

    const { pos, tangent, right, up, zAxis, roll } = scratchRef.current
    right.set(1, 0, 0).applyQuaternion(camera.quaternion)
    up.set(0, 1, 0).applyQuaternion(camera.quaternion)

    streaks.forEach((s, i) => {
      const mesh = streakRefs.current[i]
      if (!mesh) return
      const cycle = (t * s.speed + s.spawnPhase) % 1
      const theta = cycle * Math.PI * 2
      pos.set(Math.cos(theta) * s.orbitRadius, 0, Math.sin(theta) * s.orbitRadius).applyQuaternion(s.planeQuat)
      tangent
        .set(-Math.sin(theta), 0, Math.cos(theta))
        .applyQuaternion(s.planeQuat)
        .normalize()

      mesh.position.copy(pos).setY(pos.y + radius * 0.18)
      // Billboards to face the camera, then rolls in-plane to point along the streak's own real
      // 3D direction of travel projected onto the screen - a stretched quad that always faces the
      // viewer but visibly points the way it's actually moving, not a fixed "always horizontal"
      // strip.
      const screenX = tangent.dot(right)
      const screenY = tangent.dot(up)
      roll.setFromAxisAngle(zAxis, Math.atan2(screenY, screenX))
      mesh.quaternion.copy(camera.quaternion).multiply(roll)

      // Fades in and out at both ends of its own sweep rather than looping with a visible pop.
      const fade = cycle < 0.08 ? cycle / 0.08 : cycle > 0.88 ? Math.max(0, 1 - (cycle - 0.88) / 0.12) : 1
      mesh.scale.set(s.length, radius * 0.09, 1)
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.opacity = fade * 0.85 * envelope
    })
  })

  return (
    <group ref={groupRef} position={position}>
      {sand.map((p, i) => (
        <mesh key={`sand-${i}`} ref={(el) => (sandRefs.current[i] = el)}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={dotTexture}
            color={p.color}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
      {stars.map((p, i) => (
        <mesh key={`star-${i}`} ref={(el) => (starRefs.current[i] = el)} geometry={starGeometry}>
          <meshBasicMaterial
            color={p.color}
            transparent
            opacity={0}
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
      {streaks.map((_, i) => (
        <mesh key={`streak-${i}`} ref={(el) => (streakRefs.current[i] = el)}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={streakTexture}
            color="#ffffff"
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  )
}
