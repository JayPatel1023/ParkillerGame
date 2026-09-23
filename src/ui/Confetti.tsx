import { useMemo } from 'react'

// Pure CSS confetti burst for the winner overlay - requested directly (researched what makes
// mobile game UI feel "premium": particle/celebration feedback on big moments is a named "juice"
// technique, and this screen had none at all, just plain text + a button). DOM/CSS instead of a
// Three.js particle system since this overlay already lives outside the Canvas (see
// GameBoardScreen's own overlayStyle), and a few hundred absolutely-positioned spans animated with
// CSS keyframes is still far cheaper than spinning up WebGL particles for a one-shot celebration.

// Reported directly ("꽃보라량이 많게... 더멋진애니머션효과... 아이들의 동심에 맞게 3D효과로" - more
// confetti volume, a fancier animation, a real 3D effect fitting a child's sense of wonder): the
// original single top-down rain of 70 flat 2D ribbons read as one thin sprinkle, gone in a blink.
// Three changes address each part of that directly:
// 1. Volume - FALL_COUNT alone is already ~3x the old total, plus two full corner "party popper"
//    bursts on top of it (see CANNON_COUNT below) - a genuinely fuller screen, not just a few more
//    of the same pieces.
// 2. Shape variety - ribbons, dots, and PieceMesh.tsx's own five-pointed star (this game's already-
//    established "something magical" shape for children, reused here instead of inventing a new
//    one) mixed together instead of one uniform rectangle.
// 3. Real 3D - `rotateX`/`rotateY`/`rotateZ` together (not a single flat `rotate()`) so each piece
//    visibly tumbles/foreshortens in three dimensions as it falls, with `perspective` on the
//    wrapper so that foreshortening actually renders instead of silently collapsing to 2D.
const PIECE_COLORS = ['#4a78d8', '#2850a8', '#ffe08a', '#ecb84a', '#e05a4a', '#4ac86a', '#dce8ff']
const STAR_CLIP_PATH = 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)'
const SHAPES = ['ribbon', 'dot', 'star'] as const
type Shape = (typeof SHAPES)[number]
// Weighted so ribbons (the classic confetti look) still dominate, dots fill in the "fine spray",
// and stars land as an occasional sparkly accent rather than overwhelming the mix.
const SHAPE_WEIGHTS: Shape[] = ['ribbon', 'ribbon', 'ribbon', 'dot', 'dot', 'dot', 'star']

const FALL_COUNT = 200
const CANNON_COUNT_PER_SIDE = 45

function randomShape(): Shape {
  return SHAPE_WEIGHTS[Math.floor(Math.random() * SHAPE_WEIGHTS.length)]
}

function shapeStyle(shape: Shape, size: number): React.CSSProperties {
  if (shape === 'dot') return { width: size * 0.7, height: size * 0.7, borderRadius: '50%' }
  if (shape === 'star') return { width: size * 1.7, height: size * 1.7, borderRadius: 0, clipPath: STAR_CLIP_PATH }
  return { width: size, height: size * 0.4, borderRadius: 2 }
}

interface FallPiece {
  left: number
  delay: number
  duration: number
  drift: number
  color: string
  size: number
  shape: Shape
  rx: number
  ry: number
  rz: number
}

interface CannonPiece {
  fromRight: boolean
  bottomStart: number
  delay: number
  duration: number
  burstX: number
  burstY: number
  landX: number
  landY: number
  color: string
  size: number
  shape: Shape
  rx: number
  ry: number
  rz: number
}

export function Confetti() {
  const fallPieces = useMemo<FallPiece[]>(
    () =>
      Array.from({ length: FALL_COUNT }, () => ({
        left: Math.random() * 100,
        delay: Math.random() * 1.1,
        duration: 2.6 + Math.random() * 1.8,
        drift: (Math.random() - 0.5) * 200,
        color: PIECE_COLORS[Math.floor(Math.random() * PIECE_COLORS.length)],
        size: 7 + Math.random() * 7,
        shape: randomShape(),
        rx: 480 + Math.random() * 480,
        ry: 360 + Math.random() * 480,
        rz: 480 + Math.random() * 480,
      })),
    [],
  )

  // Two "party popper" cannons, one per bottom corner - each piece launches up-and-inward (the
  // burst-* midpoint), then arcs back down past the bottom edge under the same gravity-fall feel
  // as the rain pieces (the land-* endpoint), so the celebration reads as coming from multiple
  // directions at once instead of only ever raining from the top.
  const cannonPieces = useMemo<CannonPiece[]>(
    () =>
      Array.from({ length: CANNON_COUNT_PER_SIDE * 2 }, (_, i) => {
        const fromRight = i % 2 === 0
        const sign = fromRight ? -1 : 1
        const spread = 40 + Math.random() * 55
        return {
          fromRight,
          bottomStart: Math.random() * 6,
          delay: Math.random() * 0.35,
          duration: 2.1 + Math.random() * 1.4,
          burstX: sign * (spread + Math.random() * 20),
          burstY: -(55 + Math.random() * 35),
          landX: sign * (spread * 1.6 + Math.random() * 30),
          landY: 105 + Math.random() * 15,
          color: PIECE_COLORS[Math.floor(Math.random() * PIECE_COLORS.length)],
          size: 7 + Math.random() * 7,
          shape: randomShape(),
          rx: 480 + Math.random() * 480,
          ry: 360 + Math.random() * 480,
          rz: 480 + Math.random() * 480,
        }
      }),
    [],
  )

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', perspective: 800 }}>
      {fallPieces.map((p, i) => (
        <span
          key={`fall-${i}`}
          style={
            {
              position: 'absolute',
              top: -20,
              left: `${p.left}%`,
              ...shapeStyle(p.shape, p.size),
              background: p.color,
              opacity: 0.95,
              transformStyle: 'preserve-3d',
              animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s 1 both`,
              '--drift': `${p.drift}px`,
              '--rx': `${p.rx}deg`,
              '--ry': `${p.ry}deg`,
              '--rz': `${p.rz}deg`,
            } as React.CSSProperties
          }
        />
      ))}
      {cannonPieces.map((p, i) => (
        <span
          key={`cannon-${i}`}
          style={
            {
              position: 'absolute',
              bottom: `${p.bottomStart}%`,
              left: p.fromRight ? undefined : 0,
              right: p.fromRight ? 0 : undefined,
              ...shapeStyle(p.shape, p.size),
              background: p.color,
              opacity: 0.95,
              transformStyle: 'preserve-3d',
              animation: `confetti-cannon ${p.duration}s cubic-bezier(0.18, 0.8, 0.3, 1) ${p.delay}s 1 both`,
              '--burst-x': `${p.burstX}vw`,
              '--burst-y': `${p.burstY}vh`,
              '--land-x': `${p.landX}vw`,
              '--land-y': `${p.landY}vh`,
              '--rx': `${p.rx}deg`,
              '--ry': `${p.ry}deg`,
              '--rz': `${p.rz}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
