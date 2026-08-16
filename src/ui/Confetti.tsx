import { useMemo } from 'react'

// Pure CSS confetti burst for the winner overlay - requested directly (researched what makes
// mobile game UI feel "premium": particle/celebration feedback on big moments is a named "juice"
// technique, and this screen had none at all, just plain text + a button). DOM/CSS instead of a
// Three.js particle system since this overlay already lives outside the Canvas (see
// GameBoardScreen's own overlayStyle), and a few dozen absolutely-positioned divs animated with
// CSS keyframes is far cheaper than spinning up WebGL particles for a one-shot celebration.
const PIECE_COLORS = ['#4a78d8', '#2850a8', '#ffe08a', '#ecb84a', '#e05a4a', '#4ac86a', '#dce8ff']
const PIECE_COUNT = 70

interface ConfettiPiece {
  left: number
  delay: number
  duration: number
  drift: number
  color: string
  size: number
  rotate: number
}

export function Confetti() {
  const pieces = useMemo<ConfettiPiece[]>(
    () =>
      Array.from({ length: PIECE_COUNT }, () => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 2.6 + Math.random() * 1.6,
        drift: (Math.random() - 0.5) * 160,
        color: PIECE_COLORS[Math.floor(Math.random() * PIECE_COLORS.length)],
        size: 7 + Math.random() * 7,
        rotate: Math.random() * 360,
      })),
    [],
  )

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={
            {
              position: 'absolute',
              top: -20,
              left: `${p.left}%`,
              width: p.size,
              height: p.size * 0.4,
              background: p.color,
              borderRadius: 2,
              opacity: 0.95,
              transform: `rotate(${p.rotate}deg)`,
              animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s 1 both`,
              '--drift': `${p.drift}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
