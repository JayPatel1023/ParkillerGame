// Branding placeholders - replace once Carlos sends the final logo/brand colors.
const BRAND_GOLD = '#ccb154'
const BRAND_TEXT = '#f2ede0'

export function StartScreen({ onPlayLocal }: { onPlayLocal: () => void }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        color: BRAND_TEXT,
        backgroundImage: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.45) 100%), url(/backgrounds/start-bg.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <h1 style={{ fontSize: 48, margin: 0, letterSpacing: 2, textShadow: '0 2px 10px rgba(0,0,0,0.6)' }}>Parkiller</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 240 }}>
        <button
          onClick={onPlayLocal}
          style={{ padding: '14px 24px', fontSize: 18, background: BRAND_GOLD, border: 'none', borderRadius: 8 }}
        >
          Jugar local
        </button>
        <button
          disabled
          title="Disponible en el hito 2 (Photon)"
          style={{ padding: '14px 24px', fontSize: 18, background: '#8b8b8b', border: 'none', borderRadius: 8, color: '#e0e0e0' }}
        >
          Jugar online
        </button>
      </div>
    </div>
  )
}
