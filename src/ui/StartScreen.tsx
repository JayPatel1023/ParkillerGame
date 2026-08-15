// Branding placeholder - replace once Carlos sends the final logo/brand colors.
const BRAND_TEXT = '#f2ede0'

// Reported directly, with screenshots of Carlos's own earlier (Unity) prototype: its buttons were
// chunky, beveled, "carved wood/leather" tokens with real visible depth, not flat rounded
// rectangles - and this screen was the very first thing shown after the game reads. The solid
// bottom-edge (`boxShadow: '0 Npx 0 <darker>'`, no blur) is what actually reads as physical depth,
// like a pressable button sitting slightly above the surface, rather than just a bigger shadow -
// combined with a top-to-bottom gradient and an inset gloss line, the same "glass-like sheen over
// a solid color" recipe already used for the 3D pieces and the in-game HUD's own buttons, so this
// first screen reads as the same game as the board that follows it, not a plainer web page before it.
function chunkyButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    padding: '20px 44px',
    fontSize: 22,
    fontWeight: 800,
    letterSpacing: 0.4,
    color: enabled ? '#4a2e12' : '#8a8a80',
    background: enabled
      ? 'linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0) 40%), linear-gradient(180deg, #ffe08a 0%, #ecb84a 55%, #d9982e 100%)'
      : 'linear-gradient(180deg, #8a8a80, #6a6a60)',
    border: `3px solid ${enabled ? '#8a5a1e' : '#4a4a44'}`,
    borderRadius: 20,
    boxShadow: enabled
      ? '0 7px 0 #8a5a1e, 0 12px 20px rgba(0,0,0,0.45), inset 0 2px 1px rgba(255,255,255,0.55)'
      : '0 7px 0 #3a3a34, 0 10px 16px rgba(0,0,0,0.35)',
    textShadow: enabled ? '0 1px 0 rgba(255,255,255,0.35)' : 'none',
    cursor: enabled ? 'pointer' : 'default',
  }
}

export function StartScreen({ onPlayLocal }: { onPlayLocal: () => void }) {
  const canPlayOnline = Boolean(import.meta.env.VITE_PHOTON_APP_ID)
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 36,
        color: BRAND_TEXT,
        backgroundImage:
          'radial-gradient(ellipse at center, rgba(20,14,6,0.15) 0%, rgba(15,10,5,0.6) 100%), url(/backgrounds/start-bg.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <h1
        style={{
          fontSize: 56,
          margin: 0,
          letterSpacing: 3,
          fontWeight: 800,
          color: '#ffe9b8',
          textShadow: '0 2px 0 #8a5a1e, 0 6px 14px rgba(0,0,0,0.6)',
        }}
      >
        Parkiller
      </h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: 300 }}>
        <button onClick={onPlayLocal} style={chunkyButtonStyle(true)}>
          Jugar local
        </button>
        <button
          disabled={!canPlayOnline}
          title={canPlayOnline ? undefined : 'Falta configurar VITE_PHOTON_APP_ID'}
          onClick={() => (window.location.hash = '#online')}
          style={chunkyButtonStyle(canPlayOnline)}
        >
          Jugar online
        </button>
      </div>
    </div>
  )
}
