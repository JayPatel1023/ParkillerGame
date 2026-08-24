import { useEffect, useMemo } from 'react'
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
// Went through several passes: a realistic dark-walnut wood (reported as reading "basically black"
// once actually rendered - three.js's default ACES filmic tonemapping compresses dark tones
// further than they look authored), then an outdoor grass/lawn setting. Landed back on wood
// directly requested again ("이전처럼 나무 table로 만들어달라") - warmer/brighter than the first
// wood attempt so it doesn't repeat that "basically black" result.
const GROUND_SIZE = 40
const GROUND_Y = -0.015 // just under BASE_HEIGHT/the board's own y=0 plane - avoids z-fighting

function createWoodTexture(): THREE.CanvasTexture {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // Warm candlelit-table pool of light - brightest under the board, fading to a darker wood tone
  // toward the edges, baked directly into the texture rather than left to scene lighting (which
  // reads too dark on a plane this size relative to the light sources tuned for the much smaller
  // board/pieces).
  const glow = ctx.createRadialGradient(size / 2, size / 2, size * 0.06, size / 2, size / 2, size * 0.62)
  glow.addColorStop(0, '#6a4a2a')
  glow.addColorStop(0.35, '#523721')
  glow.addColorStop(0.7, '#372414')
  glow.addColorStop(1, '#1f140c')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)

  // Long, soft wood-grain streaks - kept subtle and low-frequency (large spacing, low opacity) so
  // they read as material variation, not a repeating pattern.
  for (let i = 0; i < 30; i++) {
    const y = Math.random() * size
    const amp = 10 + Math.random() * 22
    const alpha = 0.05 + Math.random() * 0.08
    ctx.strokeStyle = Math.random() > 0.5 ? `rgba(160,120,75,${alpha})` : `rgba(25,15,8,${alpha})`
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
  // continuous tabletop under one light source; tiling it (as an earlier version did) produced
  // visible seams every repeat since the radial glow doesn't tile seamlessly.
  texture.needsUpdate = true
  return texture
}

export function TableSurface() {
  const texture = useMemo(() => createWoodTexture(), [])
  useEffect(() => () => texture.dispose(), [texture])
  return (
    <mesh position={[0, GROUND_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
      <meshStandardMaterial map={texture} roughness={0.7} metalness={0.05} />
    </mesh>
  )
}
