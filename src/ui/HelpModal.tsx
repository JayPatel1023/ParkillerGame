// Reported directly, with a screenshot pointing at the exit button's own corner: no way to check
// the rules mid-game without leaving. A scrollable reference card, opened from a small "?" button
// next to the exit one, written in the same simple, player-facing language the rest of this
// screen's own copy already uses (Spanish, no PC*/PK* rule codes) - this is a reminder for someone
// already playing, not the full rulebook.
const BRAND_GOLD = '#c9a24b'

interface Section {
  title: string
  body: string[]
}

const SECTIONS: Section[] = [
  {
    title: 'Objetivo',
    body: ['Sea el primero en llevar sus 4 fichas hasta la meta.'],
  },
  {
    title: 'Los dados',
    body: [
      'Cada turno tira 2 dados blancos y 1 dado negro.',
      'Con los blancos puede mover una ficha con el valor de un dado, del otro, o con la suma de ambos.',
      'El dado negro mueve a su Parki, siempre antes que sus fichas.',
    ],
  },
  {
    title: 'Salir del refugio',
    body: ['Necesita sacar un 5 (en un dado o en la suma de los dos) para sacar una ficha del refugio a la salida.'],
  },
  {
    title: 'Capturas',
    body: [
      'Si su ficha cae exactamente sobre una ficha rival, la captura: vuelve a su refugio y gana una recompensa.',
      'Si puede capturar con una ficha, tiene que hacerlo con esa ficha - salvo que use el otro dado para mover una ficha distinta.',
    ],
  },
  {
    title: 'Barreras',
    body: [
      'Dos fichas juntas en la misma casilla forman una barrera: bloquea el paso a cualquier otra ficha, salvo al Parki, que salta por encima.',
      'Si saca dobles y tiene una barrera propia, tiene que romperla antes que cualquier otra cosa (si es posible).',
    ],
  },
  {
    title: 'Dobles',
    body: ['Sacar el mismo número en los dos dados blancos le da otra tirada. Al tercer doble seguido, la última ficha que movió vuelve al refugio.'],
  },
  {
    title: 'El Parki',
    body: [
      'Cada color tiene su propio Parki, que recorre el tablero en sentido contrario a sus fichas.',
      'Si su Parki cae sobre una ficha rival, la manda directo a su refugio (sin recompensa).',
      'Si su ficha cae sobre un Parki rival sin protección, es al revés: su ficha vuelve a su refugio.',
      'Sacando dobles, sus fichas sí pueden eliminar a un Parki rival con el número exacto - y ahí sí gana recompensa.',
    ],
  },
  {
    title: 'Recompensas',
    body: ['Capturar una ficha o un Parki le da 20 casillas de premio (puede repartirlas entre dos fichas). Llegar a la meta le da 10 más.'],
  },
  {
    title: 'La meta',
    body: ['Necesita el número exacto para entrar. Si se pasa, espere su próxima tirada.'],
  },
]

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={headerTitleStyle}>Cómo se juega</span>
          <button className="chunky-btn" onClick={onClose} title="Cerrar" style={closeButtonStyle}>
            ✕
          </button>
        </div>
        <div style={scrollAreaStyle}>
          {SECTIONS.map((section) => (
            <div key={section.title} style={sectionStyle}>
              <div style={sectionTitleStyle}>{section.title}</div>
              {section.body.map((line, i) => (
                <div key={i} style={sectionLineStyle}>
                  {line}
                </div>
              ))}
            </div>
          ))}
        </div>
        {/* Reported directly, right after this same reference card shipped: this summary is a
            reminder, not the real thing - a link to the client's own actual rulebook PDF (already
            in the repo, now also copied into public/ so Vite serves it as a static asset) opens
            it in a new tab. Pinned as its own footer, not the last item in the scroll area, so
            it's reachable without scrolling all the way down first. */}
        <div style={footerStyle}>
          <a href="/rules.pdf" target="_blank" rel="noopener noreferrer" style={rulebookLinkStyle}>
            Ver el reglamento completo (PDF) ↗
          </a>
        </div>
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
  zIndex: 20,
  padding: 16,
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: 'min(480px, 100%)',
  maxHeight: '82vh',
  borderRadius: 20,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent 20%), linear-gradient(165deg, rgba(58, 46, 30, 0.97), rgba(24, 18, 11, 0.97))',
  border: `3px solid ${BRAND_GOLD}`,
  boxShadow: '0 16px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12)',
  overflow: 'hidden',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 18px',
  borderBottom: `2px solid ${BRAND_GOLD}55`,
  flexShrink: 0,
}

const headerTitleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  color: '#f2ede0',
  letterSpacing: 0.5,
}

const closeButtonStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
  fontWeight: 700,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.22), transparent 45%), linear-gradient(165deg, rgba(64, 50, 32, 0.95), rgba(36, 28, 18, 0.95))',
  border: `2px solid ${BRAND_GOLD}`,
  borderRadius: '50%',
  color: '#f2ede0',
  cursor: 'pointer',
  flexShrink: 0,
}

const scrollAreaStyle: React.CSSProperties = {
  overflowY: 'auto',
  padding: '14px 18px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
}

const footerStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: '12px 18px',
  borderTop: `2px solid ${BRAND_GOLD}55`,
  display: 'flex',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.15)',
}

const rulebookLinkStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: BRAND_GOLD,
  textDecoration: 'none',
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  color: BRAND_GOLD,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
}

const sectionLineStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.45,
  color: '#e9e2d3',
}
