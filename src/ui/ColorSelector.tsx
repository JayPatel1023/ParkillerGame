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
// Reported directly, with a screenshot: these read as flat, cheap-looking discs next to the rest
// of the app's own carved-wood/gold-and-royal-blue polish ("촌스럽다... 품위잇게 값비싼 오락으로" -
// tacky, make it dignified, like an expensive game). Root cause of the flatness, on top of the
// plain styling itself: the previous radial-gradient specified the *same* color at both stops
// (`${color}, ${color}`) - a no-op that painted a flat fill despite looking like gradient code.
// Restyled as a real polished gem/marble - a bright off-center specular highlight fading through
// the true color into a darker rim (matching the glossy clearcoat look this project's own 3D
// pieces/dice already use for exactly this "expensive lacquered object" read), inside a metallic
// gold ring rather than a flat navy line, so these match the gold-accented premium language the
// rest of the app (hotseatButtonStyle just below, StartScreen's own CTA) is already built on.
function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const clamp = (c: number) => Math.max(0, Math.min(255, c))
  const r = clamp(((n >> 16) & 0xff) + Math.round(255 * amount))
  const g = clamp(((n >> 8) & 0xff) + Math.round(255 * amount))
  const b = clamp((n & 0xff) + Math.round(255 * amount))
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

function colorButtonStyle(color: string): React.CSSProperties {
  const highlight = lighten(color, 0.5)
  const rim = lighten(color, -0.35)
  return {
    width: 'clamp(52px, 15vw, 72px)',
    height: 'clamp(52px, 15vw, 72px)',
    fontSize: 0,
    background: `radial-gradient(circle at 34% 28%, ${highlight} 0%, ${color} 42%, ${rim} 100%)`,
    border: '3px solid #e6c876',
    borderRadius: '50%',
    boxShadow: `0 5px 0 ${rim}, 0 9px 16px rgba(0,0,0,0.45), inset 0 3px 3px rgba(255,255,255,0.65), inset 0 -5px 7px rgba(0,0,0,0.3)`,
    cursor: 'pointer',
    flexShrink: 0,
  }
}

// Reported directly (Carlos's own "life journey" philosophy - camaraderie over competition):
// this screen's own structural shadow/heading accent used to be a cold navy blue (#1a3468) with
// no connection to anything else here - swapped for the same warm bronze (#7a5f26, THEME.goldDeep)
// StartScreen's own gold trim already uses, so the whole pre-game flow reads as one warm, inviting
// object instead of switching palettes screen to screen.
const hotseatButtonStyle: React.CSSProperties = {
  padding: '12px 22px',
  fontSize: 15,
  fontWeight: 700,
  color: '#f2ede0',
  background: 'linear-gradient(165deg, rgba(255,255,255,0.1), rgba(255,255,255,0) 60%), rgba(58, 46, 30, 0.6)',
  border: '3px solid #c9a24b',
  borderRadius: 999,
  boxShadow: '0 5px 0 #7a5f26, 0 8px 12px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.2)',
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
      {/* backgroundColor here matches StartScreenBackground's own internal fog color - see
          PlayerCountSelector's own matching comment (same fix, reported on this exact screen -
          screenshot showed no board at all, just this vignette over solid black) for why. */}
      <div style={{ position: 'absolute', inset: 0, backgroundColor: '#05070c' }}>
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
            color: '#e8cf8a',
            textShadow: '0 2px 0 #7a5f26, 0 5px 12px rgba(0,0,0,0.55)',
            textAlign: 'center',
            padding: '0 12px',
          }}
        >
          ¿Con qué color juega?
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
