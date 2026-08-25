import { getColor } from '../core/colorPalette'
import type { MoveLogEntry } from '../hooks/useTurnManager'

// Reported directly (Carlos: "Hay que poder integrar en la cabeza tanto los movimientos de los
// peones propios como los de los otros jugadores y los parkis" - you have to be able to keep track
// in your head of your own pawns' moves as well as everyone else's and the parkis): nothing on
// screen ever recapped what had just happened, so keeping up meant watching every single hop live
// or losing the thread entirely. A small always-visible ticker instead of a toggled panel - a
// button to open a log is one more thing to remember to check mid-game, exactly the kind of "too
// fast to keep up with" friction this exists to fix, so the most recent few entries just sit here
// passively instead.
const BRAND_GOLD = '#c9a24b'
const MAX_VISIBLE = 4

export function MoveLog({ entries }: { entries: MoveLogEntry[] }) {
  const visible = entries.slice(0, MAX_VISIBLE)
  if (visible.length === 0) return null

  return (
    <div style={wrapStyle}>
      {visible.map((entry, i) => (
        <div key={entry.id} className="move-log-row" style={{ ...rowStyle, opacity: 1 - i * 0.22 }}>
          <span style={{ ...dotStyle, background: getColor(entry.color) }} />
          <span style={textStyle}>{entry.text}</span>
        </div>
      ))}
    </div>
  )
}

const wrapStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 16,
  left: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxWidth: 'min(280px, calc(50vw - 24px))',
  // Passive display only, nothing to click - never intercepts a piece tap on the board behind it.
  pointerEvents: 'none',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 10px',
  borderRadius: 999,
  background: 'linear-gradient(165deg, rgba(48, 30, 20, 0.9), rgba(20, 12, 8, 0.9))',
  border: `1.5px solid ${BRAND_GOLD}77`,
  boxShadow: '0 3px 8px rgba(0,0,0,0.35)',
  transition: 'opacity 0.3s ease',
  minWidth: 0,
}

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
  boxShadow: '0 0 4px rgba(0,0,0,0.5)',
}

const textStyle: React.CSSProperties = {
  fontSize: 'clamp(10px, 2.2vw, 12px)',
  color: '#e9e2d3',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
}
