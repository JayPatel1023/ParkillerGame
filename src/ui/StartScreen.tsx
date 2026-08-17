import { StartScreenBackground } from '../scene/StartScreenBackground'
import { GoldPanel } from './GoldPanel'
import { THEME } from './theme'

// Requested directly, with a full written brief and a reference photo (a candlelit wood table,
// a dark near-black-green card with a thin gold border): the earlier translucent brown panel with
// plain blue buttons read as a generic web form, not a premium tabletop game. logo-badge.png is a
// clean circular crop taken directly from the board art's own corner badge (the hooded character +
// "Parkiller" wordmark it's already drawn with) - reused here rather than commissioning new art.
// StartScreenBackground renders the real board mesh + table under a slowly auto-rotating camera
// (see that file's own comment on why a flat image/CSS pattern couldn't give real depth).
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
          background: 'radial-gradient(ellipse at center, rgba(10,8,4,0.08) 0%, rgba(4,3,2,0.74) 100%)',
        }}
      />
      <div
        style={{
          position: 'relative',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflowY: 'auto',
          boxSizing: 'border-box',
          padding: '16px 0',
        }}
      >
        <GoldPanel
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'clamp(12px, 3vh, 20px)',
            padding: 'clamp(22px, 5vh, 40px) clamp(22px, 7vw, 52px)',
            borderRadius: 22,
            maxWidth: '92vw',
          }}
        >
          <CrownIcon />
          <div
            style={{
              fontSize: 'clamp(24px, 6vw, 36px)',
              fontWeight: 800,
              letterSpacing: 3,
              color: THEME.goldBright,
              textShadow: '0 2px 10px rgba(0,0,0,0.6)',
            }}
          >
            PARKILLER
          </div>
          <img
            src="/logo-badge.png"
            alt="Parkiller"
            style={{ width: 'clamp(96px, 22vw, 156px)', height: 'clamp(96px, 22vw, 156px)', filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.5))' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(12px, 3vh, 18px)', width: 'min(300px, 70vw)', marginTop: 'clamp(4px, 1vh, 10px)' }}>
            <button className="chunky-btn chunky-btn-pulse" onClick={onPlayLocal} style={buttonStyle(true, 'green')}>
              <span aria-hidden style={{ fontSize: '0.95em' }}>👥</span> Jugar local
            </button>
            <button
              className="chunky-btn"
              disabled={!canPlayOnline}
              title={canPlayOnline ? undefined : 'Falta configurar VITE_PHOTON_APP_ID'}
              onClick={() => (window.location.hash = '#online')}
              style={buttonStyle(canPlayOnline, 'blue')}
            >
              <span aria-hidden style={{ fontSize: '0.95em' }}>🌐</span> Jugar online
            </button>
          </div>
        </GoldPanel>
      </div>
    </div>
  )
}

function CrownIcon() {
  return (
    <svg width="32" height="24" viewBox="0 0 30 22" aria-hidden focusable="false">
      <path d="M2 20 L1 7 L8 12 L15 2 L22 12 L29 7 L28 20 Z" fill={THEME.gold} stroke={THEME.goldBright} strokeWidth="1" />
    </svg>
  )
}

// Chunky carved-wood button, same physical-press recipe as the rest of the app (a solid, non-
// blurred offset bottom edge reads as depth, not a bigger blurred shadow) - now recolored per
// action: green for the local/offline action, blue for the online one, both trimmed in gold
// instead of the earlier flat single blue used for both.
const TINTS = {
  green: ['#4c8c5c', '#256234', '#123d1c'],
  blue: ['#6a9bd8', '#386b94', '#1c3b56'],
} as const

function buttonStyle(enabled: boolean, tint: keyof typeof TINTS): React.CSSProperties {
  const [light, mid, dark] = TINTS[tint]
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 'clamp(14px, 3vh, 18px) clamp(20px, 5vw, 36px)',
    fontSize: 'clamp(16px, 4vw, 20px)',
    fontWeight: 800,
    letterSpacing: 0.4,
    width: '100%',
    boxSizing: 'border-box',
    color: enabled ? THEME.cream : '#8a8a80',
    background: enabled
      ? `linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 40%), linear-gradient(180deg, ${light} 0%, ${mid} 55%, ${dark} 100%)`
      : 'linear-gradient(180deg, #6a6a60, #4a4a44)',
    border: `3px solid ${enabled ? THEME.gold : '#4a4a44'}`,
    borderRadius: 16,
    boxShadow: enabled
      ? `0 6px 0 ${THEME.goldDeep}, 0 11px 18px rgba(0,0,0,0.45), inset 0 2px 1px rgba(255,255,255,0.35)`
      : '0 6px 0 #3a3a34, 0 9px 14px rgba(0,0,0,0.3)',
    textShadow: enabled ? '0 1px 3px rgba(0,0,0,0.5)' : 'none',
    cursor: enabled ? 'pointer' : 'default',
  }
}
