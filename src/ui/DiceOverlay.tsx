import { useEffect, useState } from 'react'

// Fixed screen-space UI instead of a 3D mesh in the board scene - a die placed in world space is
// always at the mercy of the tilted camera's framing, which (measured directly, twice) leaves
// inconsistent margin past the board's edge depending on viewport aspect ratio: sometimes it rests
// on top of real track squares, sometimes it's pushed half (or fully) off-screen. Screen-space
// placement can't overlap the board by construction and is always visible, regardless of which
// board is loaded or what shape the window is.

// Grid-cell pip layout (3x3), same dot pattern a real die face uses.
const PIP_LAYOUT: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [0, 2],
    [2, 0],
    [2, 2],
  ],
  5: [
    [0, 0],
    [0, 2],
    [1, 1],
    [2, 0],
    [2, 2],
  ],
  6: [
    [0, 0],
    [0, 2],
    [1, 0],
    [1, 2],
    [2, 0],
    [2, 2],
  ],
}

function Die({ value, rolling, delay }: { value: number | null; rolling: boolean; delay: number }) {
  // Cycles through faces while rolling so the die reads as tumbling, not just frozen with a spinner
  // - same "spin then settle" feel the 3D version had, done here with a plain interval instead of
  // a physics-driven rotation.
  const [displayValue, setDisplayValue] = useState(value ?? 1)

  useEffect(() => {
    if (!rolling) {
      if (value !== null) setDisplayValue(value)
      return
    }
    const id = setInterval(() => setDisplayValue(1 + Math.floor(Math.random() * 6)), 90)
    return () => clearInterval(id)
  }, [rolling, value])

  const pips = PIP_LAYOUT[displayValue] ?? []

  return (
    <div
      style={{
        width: 44,
        height: 44,
        background: '#f6f3ec',
        borderRadius: 8,
        border: '1px solid rgba(0,0,0,0.25)',
        boxShadow: '0 3px 8px rgba(0,0,0,0.45), inset 0 1px 1px rgba(255,255,255,0.6)',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        padding: 6,
        boxSizing: 'border-box',
        animation: rolling ? `dice-roll-shake 0.35s ease-in-out ${delay}ms infinite` : 'none',
      }}
    >
      {pips.map(([row, col], i) => (
        <span
          key={i}
          style={{
            gridRow: row + 1,
            gridColumn: col + 1,
            width: 8,
            height: 8,
            margin: 'auto',
            borderRadius: '50%',
            background: '#2a2a2a',
            boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.5)',
          }}
        />
      ))}
    </div>
  )
}

export function DiceOverlay({
  values,
  rolling,
  onClick,
  disabled,
}: {
  values: [number | null, number | null]
  rolling: boolean
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? undefined : 'Tirar dados'}
      style={{
        position: 'absolute',
        right: 16,
        bottom: 16,
        display: 'flex',
        gap: 10,
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled && !rolling ? 0.55 : 1,
      }}
    >
      <Die value={values[0]} rolling={rolling} delay={0} />
      <Die value={values[1]} rolling={rolling} delay={60} />
    </button>
  )
}
