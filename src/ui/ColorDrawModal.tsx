import { useEffect, useRef, useState } from 'react'
import { getColor } from '../core/colorPalette'
import { PIECE_COLORS, type PieceColor } from '../core/pieceColor'

// Requested directly ("un carrusel para sortear el color de cada jugador" - a carousel to draw
// each player's color): online play never had a color *choice* to begin with (unlike local play's
// own ColorSelector, a real "the player must be able to choose" requirement left untouched - see
// OnlineLobbyScreen.tsx's own shuffleColorsByActorNr doc comment) - it silently assigned colors by
// join order, with nothing on screen showing it. The random draw itself already happened
// synchronously before this component exists (same pattern as StartingPlayerModal's own dice
// roll-off) - this only plays a brief "spinning through every color" animation per seat before
// settling on the real, already-decided result, so it reads as an actual draw rather than a
// silent assignment.
const BRAND_GOLD = '#c9a24b'
const SPIN_MS = 1600
const SPIN_TICK_MS = 90
const HOLD_AFTER_SPIN_MS = 2400

export interface ColorDrawEntry {
  color: PieceColor
  isBot: boolean
}

export function ColorDrawModal({
  assignments,
  localPlayerColor,
  onDone,
}: {
  assignments: ColorDrawEntry[]
  localPlayerColor: PieceColor | null
  onDone: () => void
}) {
  const [visible, setVisible] = useState(true)
  const [spinning, setSpinning] = useState(true)
  const [displayColors, setDisplayColors] = useState<PieceColor[]>(() => assignments.map((a) => a.color))
  const spinStartRef = useRef(Date.now())

  useEffect(() => {
    spinStartRef.current = Date.now()
    const tick = setInterval(() => {
      setDisplayColors(assignments.map(() => PIECE_COLORS[Math.floor(Math.random() * PIECE_COLORS.length)]))
    }, SPIN_TICK_MS)
    const stopSpin = setTimeout(() => {
      clearInterval(tick)
      setSpinning(false)
      setDisplayColors(assignments.map((a) => a.color))
    }, SPIN_MS)
    return () => {
      clearInterval(tick)
      clearTimeout(stopSpin)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (spinning) return
    const timer = setTimeout(() => setVisible(false), HOLD_AFTER_SPIN_MS)
    return () => clearTimeout(timer)
  }, [spinning])

  useEffect(() => {
    if (!visible) onDone()
  }, [visible, onDone])

  if (!visible) return null

  return (
    <div style={backdropStyle} onClick={() => !spinning && setVisible(false)}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={titleStyle}>Sorteo de colores</div>
        <div style={subtitleStyle}>{spinning ? 'Repartiendo los colores...' : '¡Colores asignados!'}</div>
        <div style={rowsStyle}>
          {assignments.map((entry, i) => {
            const isYou = !spinning && localPlayerColor !== null && entry.color === localPlayerColor
            return (
              <div key={i} style={{ ...rowStyle, borderColor: isYou ? BRAND_GOLD : `${BRAND_GOLD}55` }}>
                <span style={{ ...dotStyle, background: getColor(displayColors[i]) }} />
                <span style={labelStyle}>{spinning ? ' ' : isYou ? 'Vos' : entry.isBot ? 'Bot' : 'Jugador'}</span>
              </div>
            )
          })}
        </div>
        <button className="chunky-btn" onClick={() => setVisible(false)} disabled={spinning} style={continueButtonStyle(spinning)}>
          Continuar
        </button>
      </div>
    </div>
  )
}

const backdropStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.6)',
  zIndex: 25,
  padding: 16,
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  width: 'min(360px, 100%)',
  padding: '22px 24px',
  borderRadius: 20,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent 20%), linear-gradient(165deg, rgba(58, 46, 30, 0.97), rgba(24, 18, 11, 0.97))',
  border: `3px solid ${BRAND_GOLD}`,
  boxShadow: '0 16px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12)',
}

const titleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  color: '#f2ede0',
  letterSpacing: 0.5,
}

const subtitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#c9bda3',
  marginTop: -6,
}

const rowsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: 8,
  width: '100%',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  borderRadius: 999,
  background: 'rgba(0,0,0,0.3)',
  border: '1.5px solid',
}

const dotStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: '50%',
  flexShrink: 0,
  boxShadow: '0 0 4px rgba(0,0,0,0.5)',
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: '#f2ede0',
}

const continueButtonStyle = (disabled: boolean): React.CSSProperties => ({
  marginTop: 4,
  padding: '10px 28px',
  fontSize: 14,
  fontWeight: 700,
  opacity: disabled ? 0.5 : 1,
  cursor: disabled ? 'default' : 'pointer',
})
