import { useMemo } from 'react'
import * as THREE from 'three'
import { BOARD_SIZE } from './boardGeometry'

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
// Went through several passes: a realistic dark-walnut wood (reported as reading "basically black"
// once actually rendered - three.js's default ACES filmic tonemapping compresses dark tones
// further than they look authored), a brighter warm wood, then an outdoor grass/lawn setting. All
// landed on this pass instead: a real dark-wood tabletop, per a full written brief asking for a
// "cozy/warm/elegant premium board game on a real wooden table" feel rather than an outdoor scene.
const GROUND_SIZE = 40
const GROUND_Y = -0.02 // just under the mat's own y (see MAT_Y) - avoids z-fighting
const MAT_Y = -0.008 // between the ground and the board's own y=0 plane

function createWoodTableTexture(): THREE.CanvasTexture {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // Warm "candlelit table" pool of light - brightest under the board, fading to a near-black
  // wood tone at the edges, baked directly into the texture rather than left to scene lighting
  // (which reads too dark on a plane this size relative to the light tuned for the much smaller
  // board/pieces).
  const glow = ctx.createRadialGradient(size / 2, size / 2, size * 0.06, size / 2, size / 2, size * 0.62)
  glow.addColorStop(0, '#5a3f26')
  glow.addColorStop(0.35, '#432d1a')
  glow.addColorStop(0.7, '#2a1c11')
  glow.addColorStop(1, '#120c07')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)

  // Long, soft wood-grain streaks - kept subtle and low-frequency (large spacing, low opacity) so
  // they read as material variation, not a repeating pattern.
  for (let i = 0; i < 30; i++) {
    const y = Math.random() * size
    const amp = 10 + Math.random() * 22
    const alpha = 0.05 + Math.random() * 0.08
    ctx.strokeStyle = Math.random() > 0.5 ? `rgba(150,110,70,${alpha})` : `rgba(20,12,7,${alpha})`
    ctx.lineWidth = 2 + Math.random() * 4
    ctx.beginPath()
    ctx.moveTo(0, y)
    for (let x = 0; x <= size; x += 48) {
      ctx.lineTo(x, y + Math.sin(x * 0.01 + i) * amp)
    }
    ctx.stroke()
  }

  const texture = new THREE.CanvasTexture(canvas)
  // No repeat wrapping - a single large gradient-lit texture across the whole plane reads as one
  // continuous table under one warm light source; tiling it produced visible seams every repeat
  // since the radial glow doesn't tile seamlessly.
  texture.needsUpdate = true
  return texture
}

// A thin dark-green felt mat sitting between the wood table and the board itself, slightly larger
// than the board's own footprint - reads as "a real board resting on a mat on a table" instead of
// the board floating directly over bare wood. Solid color (not a second canvas texture) is enough
// at this size; it only shows as a slim border ring around the board.
function createMatTexture(): THREE.CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const glow = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.7)
  glow.addColorStop(0, '#1f3326')
  glow.addColorStop(1, '#0e1a12')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

export function TableSurface() {
  const woodTexture = useMemo(() => createWoodTableTexture(), [])
  const matTexture = useMemo(() => createMatTexture(), [])
  const matSize = BOARD_SIZE * 1.1
  return (
    <>
      <mesh position={[0, GROUND_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        <meshStandardMaterial map={woodTexture} roughness={0.65} metalness={0.05} />
      </mesh>
      <mesh position={[0, MAT_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[matSize, matSize]} />
        <meshStandardMaterial map={matTexture} roughness={0.92} metalness={0} />
      </mesh>
    </>
  )
}
