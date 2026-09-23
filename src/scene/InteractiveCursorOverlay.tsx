import { useEffect, useState } from 'react'
import { subscribeInteractiveCursor } from './interactiveCursorState'

// Requested directly ("마우스 지시자표시도 애니메이션효과를 넣어멋지게 아이들의 동심에 맞게 만들어줘" -
// give the mouse cursor indicator an animation too, cool, fitting a child's sense of wonder). This
// replaces interactiveCursor.ts's own static `cursor: url(...)` SVG (a single fixed image - no
// browser animates a cursor image, so that approach had a hard ceiling) with a real DOM element
// that follows the pointer, which CSS keyframes can animate freely. Keeps the exact same gold-gem
// arrow shape that static cursor already had (recognizable, unchanged), and only animates the small
// sparkle accent - a slow spin-and-pulse, not a redesign - matching this game's own established
// "one quiet twinkle, not a flashy multi-part effect" language for anything aimed at reading as
// "something magical" to a child (see PieceMesh.tsx's own selectable-piece star for the same idea).
const SIZE = 26

export function InteractiveCursorOverlay() {
  const [active, setActive] = useState(false)
  const [position, setPosition] = useState({ x: -100, y: -100 })

  useEffect(() => subscribeInteractiveCursor(setActive), [])

  // Tracked unconditionally, not just while active - onPointerOver already fires the instant the
  // mouse *arrives* over an interactive mesh, with no further mousemove guaranteed to follow (a
  // player who hovers a piece and then holds still, easily the common case, generates none at
  // all). Only attaching this listener once `active` had already flipped true left `position` at
  // its stale initial value for as long as the mouse stayed still - on screen, but parked at
  // (-100,-100), i.e. invisible - confirmed directly via a DOM query mid-hover showing exactly
  // that. Tracking always instead means `position` is already correct the instant `active` turns
  // true, whatever the mouse did to get there.
  useEffect(() => {
    const onMove = (e: PointerEvent) => setPosition({ x: e.clientX, y: e.clientY })
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  // Hides the real OS cursor only while this stands in for it - restored on every toggle back to
  // inactive, and on unmount, so this can never strand the page with no visible cursor at all.
  useEffect(() => {
    document.body.style.cursor = active ? 'none' : 'auto'
    return () => {
      document.body.style.cursor = 'auto'
    }
  }, [active])

  if (!active) return null

  return (
    <div
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        // Matches the old static cursor's own (3,1) hotspot - clicks still register at the
        // arrow's own tip, not this element's bounding-box corner.
        transform: 'translate(-3px, -1px)',
        width: SIZE,
        height: SIZE,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      <svg width={SIZE} height={SIZE} viewBox="0 0 24 24">
        <defs>
          <linearGradient id="interactive-cursor-gem" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f5e2a8" />
            <stop offset="55%" stopColor="#c9a24b" />
            <stop offset="100%" stopColor="#8a6a2c" />
          </linearGradient>
        </defs>
        <path
          d="M3 1 L3 17.5 L7 13.8 L9.7 19.8 L12.4 18.5 L9.7 12.6 L15 12.6 Z"
          fill="url(#interactive-cursor-gem)"
          stroke="#2b2013"
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
        <g className="interactive-cursor-sparkle">
          <circle cx={18.5} cy={4.5} r={1.6} fill="#fff3cf" />
          <path d="M18.5 2.2 L18.9 3.9 L20.6 4.3 L18.9 4.7 L18.5 6.4 L18.1 4.7 L16.4 4.3 L18.1 3.9 Z" fill="#fff3cf" />
        </g>
      </svg>
      <style>{`
        @keyframes interactive-cursor-spin {
          0% { transform: rotate(0deg) scale(1); opacity: 0.7; }
          50% { transform: rotate(180deg) scale(1.4); opacity: 1; }
          100% { transform: rotate(360deg) scale(1); opacity: 0.7; }
        }
        .interactive-cursor-sparkle {
          transform-origin: 18.5px 4.5px;
          animation: interactive-cursor-spin 1.6s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
