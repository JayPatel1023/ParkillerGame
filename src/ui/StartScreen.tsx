import { StartScreenBackground } from '../scene/StartScreenBackground'

// Branding placeholder - replace once Carlos sends the final logo/brand colors.
const BRAND_TEXT = '#f2ede0'

// Reported directly, three times: a flat blurry photo, a sharper photo, and a CSS-only pattern all
// still read as "not three-dimensional enough" for a title screen - a real background needs actual
// depth (perspective, lighting, shadows), which only the game's own Three.js board can genuinely
// provide, not a 2D asset however it's processed. StartScreenBackground renders the real board mesh
// under a slowly auto-rotating camera instead of a static image. logo-badge.png is a clean circular
// crop taken directly from the board art's own corner badge (the hooded character + "Parkiller"
// wordmark it's already drawn with) - reuses real game art instead of a plain text heading alone.
export function StartScreen({ onPlayLocal }: { onPlayLocal: () => void }) {
  const canPlayOnline = Boolean(import.meta.env.VITE_PHOTON_APP_ID)
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
          gap: 30,
          color: BRAND_TEXT,
          overflowY: 'auto',
          boxSizing: 'border-box',
          padding: '16px 0',
        }}
      >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'clamp(16px, 4vh, 28px)',
          padding: 'clamp(20px, 5vh, 40px) clamp(20px, 7vw, 56px)',
          borderRadius: 28,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent 25%), linear-gradient(165deg, rgba(58, 46, 30, 0.72), rgba(30, 23, 14, 0.72))',
          border: '2px solid #1a3468',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5), inset 0 0 0 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
          maxWidth: '92vw',
          boxSizing: 'border-box',
        }}
      >
        <img
          src="/logo-badge.png"
          alt="Parkiller"
          style={{ width: 'clamp(100px, 24vw, 168px)', height: 'clamp(100px, 24vw, 168px)', filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.5))' }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(12px, 3vh, 20px)', width: 'min(300px, 70vw)' }}>
          <button className="chunky-btn" onClick={onPlayLocal} style={chunkyButtonStyle(true)}>
            Jugar local
          </button>
          <button
            className="chunky-btn"
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
    </div>
  )
}

// Chunky carved-wood button - same recipe used across the rest of the app (PlayerCountSelector,
// GameBoardScreen's HUD): a solid (non-blurred) offset bottom edge is what reads as physical
// depth, not just a bigger blurred shadow, combined with a glossy top-highlight gradient matching
// the 3D pieces' own clearcoat material.
function chunkyButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    padding: 'clamp(14px, 3vh, 20px) clamp(24px, 6vw, 44px)',
    fontSize: 'clamp(17px, 4.5vw, 22px)',
    fontWeight: 800,
    letterSpacing: 0.4,
    width: '100%',
    boxSizing: 'border-box',
    color: enabled ? '#eef4ff' : '#8a8a80',
    background: enabled
      ? 'linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0) 40%), linear-gradient(180deg, #c8dcff 0%, #4a78d8 55%, #2850a8 100%)'
      : 'linear-gradient(180deg, #8a8a80, #6a6a60)',
    border: `3px solid ${enabled ? '#1a3468' : '#4a4a44'}`,
    borderRadius: 20,
    boxShadow: enabled
      ? '0 7px 0 #1a3468, 0 12px 20px rgba(0,0,0,0.45), inset 0 2px 1px rgba(255,255,255,0.55)'
      : '0 7px 0 #3a3a34, 0 10px 16px rgba(0,0,0,0.35)',
    textShadow: enabled ? '0 1px 2px rgba(8,16,40,0.5)' : 'none',
    cursor: enabled ? 'pointer' : 'default',
  }
}
