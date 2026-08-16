// Branding placeholder - replace once Carlos sends the final logo/brand colors.
const BRAND_TEXT = '#f2ede0'

// Reported directly, twice: the background read as an unstyled blurry smear, not a designed title
// screen. The asset behind it (public/backgrounds/start-bg.jpg) turned out to be genuinely
// low-resolution/soft even before any CSS blur was applied to it - no amount of styling fixes a
// blurry source image. Switched to one of the actual in-game board textures (public/boards/), which
// is sharp, and dialed the blur/dim down since it no longer needs hiding. logo-badge.png is a clean
// circular crop taken directly from that same board art's own corner badge (the hooded character +
// "Parkiller" wordmark it's already drawn with) - reuses real game art instead of a plain text
// heading standing alone.
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
        gap: 30,
        color: BRAND_TEXT,
        backgroundImage:
          'radial-gradient(ellipse at center, rgba(10,8,4,0.35) 0%, rgba(8,6,3,0.82) 100%), url(/boards/board_4p.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 28,
          padding: '40px 56px',
          borderRadius: 28,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent 25%), linear-gradient(165deg, rgba(58, 46, 30, 0.72), rgba(30, 23, 14, 0.72))',
          border: '2px solid #8a5a1e',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5), inset 0 0 0 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
        }}
      >
        <img
          src="/logo-badge.png"
          alt="Parkiller"
          style={{ width: 168, height: 168, filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.5))' }}
        />
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
    </div>
  )
}

// Chunky carved-wood button - same recipe used across the rest of the app (PlayerCountSelector,
// GameBoardScreen's HUD): a solid (non-blurred) offset bottom edge is what reads as physical
// depth, not just a bigger blurred shadow, combined with a glossy top-highlight gradient matching
// the 3D pieces' own clearcoat material.
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
