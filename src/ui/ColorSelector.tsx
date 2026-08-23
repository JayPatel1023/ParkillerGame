import { StartScreenBackground } from '../scene/StartScreenBackground'
import { getColor } from '../core/colorPalette'
import type { PieceColor } from '../core/pieceColor'

// Reported directly ("EL JUGADOR AL INICIO DEBE PODER ELEGIR EL COLOR Y JUGAR CONTRA LOS OTROS
// OPONENTE PILOTADOS POR EL BOT. AHORA EL JUGADOR JUEGA CON TODOS LOS COLORES, PERO HAY QUE PODER
// ATRIBUIR UN COLOR A CADA JUGADOR Y QUE LOS OTROS LOS CONTROLE EL SISTEMA" - the player should be
// able to choose their color at the start and play against bot-piloted opponents; right now the
// player plays every color, but there needs to be a way to assign one color to the human and let
// the system control the rest): local play only ever had one mode - every color passed hotseat,
// same human playing all of them in turn. Slotted in right after PlayerCountSelector, same visual
// language (StartScreenBackground + round token buttons), offering one new choice per color in
// this count's own TURN_ORDER_BY_COUNT plus an explicit "all human" option that preserves the
// original hotseat mode exactly - this is additive, not a replacement, since pass-and-play is
// still a real, intentional mode of its own (not just "vs bots minus picking a color").
function colorButtonStyle(color: string): React.CSSProperties {
  return {
    width: 'clamp(46px, 14vw, 64px)',
    height: 'clamp(46px, 14vw, 64px)',
    fontSize: 0,
    fontWeight: 800,
    background: `linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0) 45%), radial-gradient(circle at 35% 30%, ${color}, ${color})`,
    border: '3px solid #1a3468',
    borderRadius: '50%',
    boxShadow: '0 5px 0 #1a3468, 0 9px 14px rgba(0,0,0,0.4), inset 0 2px 1px rgba(255,255,255,0.55)',
    cursor: 'pointer',
    flexShrink: 0,
  }
}

const hotseatButtonStyle: React.CSSProperties = {
  padding: '12px 22px',
  fontSize: 15,
  fontWeight: 700,
  color: '#f2ede0',
  background: 'linear-gradient(165deg, rgba(255,255,255,0.1), rgba(255,255,255,0) 60%), rgba(58, 46, 30, 0.6)',
  border: '3px solid #c9a24b',
  borderRadius: 999,
  boxShadow: '0 5px 0 #1a3468, 0 8px 12px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.2)',
  cursor: 'pointer',
}

export function ColorSelector({
  colors,
  onConfirm,
}: {
  colors: PieceColor[]
  onConfirm: (humanColor: PieceColor | null) => void
}) {
  return (
    <div style={{ height: '100%', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <StartScreenBackground />
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at center, rgba(10,8,4,0.15) 0%, rgba(6,8,14,0.7) 100%)',
        }}
      />
      <div
        style={{
          position: 'relative',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 28,
          color: '#f2ede0',
        }}
      >
        <h2
          style={{
            fontSize: 'clamp(22px, 6vw, 30px)',
            fontWeight: 800,
            margin: 0,
            letterSpacing: 1,
            color: '#dce8ff',
            textShadow: '0 2px 0 #1a3468, 0 5px 12px rgba(0,0,0,0.55)',
            textAlign: 'center',
            padding: '0 12px',
          }}
        >
          ¿Con qué color jugás?
        </h2>
        <div style={{ display: 'flex', gap: 'clamp(8px, 3vw, 18px)', padding: '0 12px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {colors.map((color) => (
            <button
              key={color}
              className="chunky-btn"
              aria-label={color}
              onClick={() => onConfirm(color)}
              style={colorButtonStyle(getColor(color))}
            />
          ))}
        </div>
        <button className="chunky-btn" onClick={() => onConfirm(null)} style={hotseatButtonStyle}>
          Jugar todos los colores (sin bots)
        </button>
      </div>
    </div>
  )
}
