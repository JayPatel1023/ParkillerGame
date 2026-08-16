import { useMemo } from 'react'
import * as THREE from 'three'

// Reported directly, with screenshots: the actual game screen still had flat black margins around
// the board on any viewport wider/taller than the board's own square aspect - a plain CSS radial
// glow behind the Canvas (see GameBoardScreen's screenWrapperStyle) wasn't enough once the start
// screen got a real rotating 3D environment, the mismatch became obvious. A square board inside a
// landscape (or portrait) window always leaves margin beside it - no camera-fit math changes that
// geometry (see BoardScene's own comment on this) - so the fix isn't "make the board bigger", it's
// "make the margin real 3D geometry instead of empty CSS space". This is a large wood-toned plane
// sitting just under the board, extending far past it in every direction, so the board reads as
// sitting on a real table rather than floating over a flat color.
//
// First pass used realistic dark-walnut tones (~#20150c) with fine grain lines - reported directly
// as still reading as "basically black" with visible tiling seams. Three.js's default ACES filmic
// tonemapping compresses dark tones further than they look authored, so anything subtle in that
// range disappears entirely once rendered - this version leans much brighter/warmer than a
// realistic table would need, with a bold baked-in radial "pool of light" (bright under the board,
// darkening toward the edges) instead of relying on fine grain contrast that wasn't reading at any
// real viewing distance anyway.
const TABLE_SIZE = 40
const TABLE_Y = -0.015 // just under BASE_HEIGHT/the board's own y=0 plane - avoids z-fighting

function createWoodTexture(): THREE.CanvasTexture {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // Warm radial "pool of light" - brightest at center (under the board), fading toward the edges,
  // baked directly into the texture rather than left to scene lighting (which reads too dark on
  // a plane this size relative to the light sources tuned for the much-smaller board/pieces).
  const glow = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.62)
  glow.addColorStop(0, '#6a4526')
  glow.addColorStop(0.35, '#54371e')
  glow.addColorStop(0.7, '#3a2415')
  glow.addColorStop(1, '#1c130b')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)

  // A few long, soft grain streaks for texture - kept subtle and low-frequency (large spacing, low
  // opacity) so they read as material variation, not a repeating pattern.
  for (let i = 0; i < 26; i++) {
    const y = Math.random() * size
    const amp = 14 + Math.random() * 26
    const alpha = 0.05 + Math.random() * 0.07
    ctx.strokeStyle = Math.random() > 0.5 ? `rgba(140,100,60,${alpha})` : `rgba(20,12,6,${alpha})`
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
  // continuous table under one light source; tiling it (as an earlier version did) produced
  // visible seams every repeat since the radial glow doesn't tile seamlessly.
  texture.needsUpdate = true
  return texture
}

export function TableSurface() {
  const texture = useMemo(() => createWoodTexture(), [])
  return (
    <mesh position={[0, TABLE_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[TABLE_SIZE, TABLE_SIZE]} />
      <meshStandardMaterial map={texture} roughness={0.75} metalness={0.05} />
    </mesh>
  )
}
