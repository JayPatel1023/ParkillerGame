import { useMemo } from 'react'
import * as THREE from 'three'

// Reported directly, with screenshots: the actual game screen still had flat black margins around
// the board on any viewport wider/taller than the board's own square aspect - a plain CSS radial
// glow behind the Canvas (see GameBoardScreen's screenWrapperStyle) wasn't enough once the start
// screen got a real rotating 3D environment, the mismatch became obvious. A square board inside a
// landscape (or portrait) window always leaves margin beside it - no camera-fit math changes that
// geometry (see BoardScene's own comment on this) - so the fix isn't "make the board bigger", it's
// "make the margin real 3D geometry instead of empty CSS space". This is a large ground-toned plane
// sitting just under the board, extending far past it in every direction, so the board reads as
// resting on a real surface rather than floating over a flat color.
//
// Went through two color passes before this one: a realistic dark-walnut wood (reported as reading
// "basically black" once actually rendered - three.js's default ACES filmic tonemapping compresses
// dark tones further than they look authored) and a brighter warm wood (reported directly as still
// not feeling vibrant/alive enough - "색갈이 여전히 맘에 없다"). Landed on an outdoor grass/lawn
// setting instead, picked directly from three mocked-up options (green felt, warm mahogany, bright
// grass) rendered and compared side by side rather than guessed blind again.
const GROUND_SIZE = 40
const GROUND_Y = -0.015 // just under BASE_HEIGHT/the board's own y=0 plane - avoids z-fighting

function createGrassTexture(): THREE.CanvasTexture {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // Bright "sunlit lawn" pool of light - brightest at center (under the board), fading toward the
  // edges, baked directly into the texture rather than left to scene lighting (which reads too
  // dark on a plane this size relative to the light sources tuned for the much-smaller
  // board/pieces).
  const glow = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.62)
  glow.addColorStop(0, '#4a8a3a')
  glow.addColorStop(0.35, '#3c7530')
  glow.addColorStop(0.7, '#285420')
  glow.addColorStop(1, '#142c10')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)

  // A few long, soft blade-texture streaks - kept subtle and low-frequency (large spacing, low
  // opacity) so they read as material variation, not a repeating pattern.
  for (let i = 0; i < 26; i++) {
    const y = Math.random() * size
    const amp = 14 + Math.random() * 26
    const alpha = 0.05 + Math.random() * 0.07
    ctx.strokeStyle = Math.random() > 0.5 ? `rgba(120,190,90,${alpha})` : `rgba(15,40,10,${alpha})`
    ctx.lineWidth = 3 + Math.random() * 5
    ctx.beginPath()
    ctx.moveTo(0, y)
    for (let x = 0; x <= size; x += 48) {
      ctx.lineTo(x, y + Math.sin(x * 0.012 + i) * amp)
    }
    ctx.stroke()
  }

  const texture = new THREE.CanvasTexture(canvas)
  // No repeat wrapping - a single large gradient-lit texture across the whole plane reads as one
  // continuous lawn under one light source; tiling it (as an earlier version did) produced visible
  // seams every repeat since the radial glow doesn't tile seamlessly.
  texture.needsUpdate = true
  return texture
}

export function TableSurface() {
  const texture = useMemo(() => createGrassTexture(), [])
  return (
    <mesh position={[0, GROUND_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
      <meshStandardMaterial map={texture} roughness={0.85} metalness={0} />
    </mesh>
  )
}
