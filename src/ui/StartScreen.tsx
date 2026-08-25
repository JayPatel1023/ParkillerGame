import { useState } from 'react'
import { GoldPanel } from './GoldPanel'
import { THEME } from './theme'

// Where "Ayuda" (inside the settings panel below) sends the player - supplied directly, not
// guessed.
const HELP_URL = 'https://moonlighteditors.com/instructions-parkiller/'

// Requested directly, with a full written brief and a reference photo (a candlelit wood table,
// a dark near-black-green card with a thin gold border): the earlier translucent brown panel with
// plain blue buttons read as a generic web form, not a premium tabletop game. logo-badge.png is a
// clean circular crop taken directly from the board art's own corner badge (the hooded character +
// "Parkiller" wordmark it's already drawn with) - reused here rather than commissioning new art.
// Background: a real photo (public/backgrounds/firstbag.jpg, supplied directly) - the earlier 3D
// rotating-board background (StartScreenBackground) was only ever a stand-in built because no such
// photo existed yet; now that one does, it replaces the 3D scene here rather than the 3D scene
// trying to recreate it.
export function StartScreen({ onPlayLocal }: { onPlayLocal: () => void }) {
  const canPlayOnline = Boolean(import.meta.env.VITE_PHOTON_APP_ID)
  // Reported directly: the app had no settings entry point at all. Kept to exactly what was
  // asked for - a settings button whose one item opens the help page - rather than inventing
  // placeholder rows (sound/language toggles etc.) with no real functionality behind them yet.
  const [showSettings, setShowSettings] = useState(false)
  return (
    <div style={{ height: '100%', position: 'relative', backgroundColor: THEME.wood }}>
      {/* `cover` (not `contain`) so the photo fills every viewport edge to edge with zero visible
          margin - see index.css's own .start-bg-photo comment for why firstbag.jpg doesn't need
          the per-breakpoint crop/position tuning an earlier photo here did. */}
      <div className="start-bg-photo" style={{ position: 'absolute', inset: 0, backgroundColor: THEME.wood, backgroundSize: 'cover', backgroundRepeat: 'no-repeat' }} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at center, rgba(10,8,4,0.03) 0%, rgba(8,6,4,0.42) 100%)',
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
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'clamp(6px, 1.8vh, 16px)',
            padding: 'clamp(14px, 3.6vh, 48px) clamp(16px, 6vw, 62px)',
            borderRadius: 22,
            maxWidth: '92vw',
          }}
        >
          {/* Straddles the card's own top border (half above, half below) instead of sitting as a
              separate divider-framed row - matches a reference showing the crown as a crest
              overlapping the frame edge. */}
          <div style={{ position: 'absolute', top: -15, left: '50%', transform: 'translateX(-50%)' }}>
            <CrownIcon />
          </div>
          <div
            style={{
              fontSize: 'clamp(19px, 5.2vw, 42px)',
              fontWeight: 800,
              letterSpacing: 4,
              color: THEME.goldBright,
              textShadow: '0 1px 0 rgba(255,255,255,0.35), 0 -1px 1px rgba(0,0,0,0.5), 0 3px 8px rgba(0,0,0,0.6)',
              marginTop: 'clamp(6px, 1.5vh, 14px)',
            }}
          >
            PARKILLER
          </div>
          <GoldDivider accent />
          <img
            src="/logo-badge.png"
            alt="Parkiller"
            style={{ width: 'clamp(58px, 16vw, 180px)', height: 'clamp(58px, 16vw, 180px)', filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.5))', marginTop: 4 }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(7px, 1.8vh, 18px)', width: 'min(360px, 72vw)', marginTop: 'clamp(2px, 0.8vh, 10px)' }}>
            <button className="chunky-btn chunky-btn-pulse" onClick={onPlayLocal} style={buttonStyle(true, 'green')}>
              <span aria-hidden style={iconBadgeStyle}><PeopleIcon /></span> JUGAR LOCAL
            </button>
            <button
              className="chunky-btn"
              disabled={!canPlayOnline}
              title={canPlayOnline ? undefined : 'Falta configurar VITE_PHOTON_APP_ID'}
              onClick={() => (window.location.hash = '#online')}
              style={buttonStyle(canPlayOnline, 'burgundy')}
            >
              <span aria-hidden style={iconBadgeStyle}><GlobeIcon /></span> JUGAR ONLINE
            </button>
          </div>
        </GoldPanel>
      </div>

      <button className="chunky-btn" onClick={() => setShowSettings(true)} title="Configuración" style={settingsButtonStyle}>
        <GearIcon />
      </button>

      {showSettings && (
        <div style={settingsOverlayStyle}>
          <GoldPanel style={settingsPanelStyle}>
            <div style={{ fontSize: 20, fontWeight: 800, color: THEME.goldBright, letterSpacing: 0.5 }}>Configuración</div>
            <button
              className="chunky-btn"
              onClick={() => window.open(HELP_URL, '_blank', 'noopener,noreferrer')}
              style={settingsRowStyle}
            >
              <span aria-hidden style={iconBadgeStyle}><HelpIcon /></span> Ayuda
            </button>
            <button className="chunky-btn" onClick={() => setShowSettings(false)} style={settingsCloseStyle}>
              Cerrar
            </button>
          </GoldPanel>
        </div>
      )}
    </div>
  )
}

// Requested directly, side by side with a more polished reference: the plain flat crown silhouette
// read as too simple - the reference has a jeweled crown (small circles on each point) plus a base
// band, and gold divider lines framing the title instead of the title floating on its own.
function CrownIcon() {
  return (
    <svg width="36" height="28" viewBox="0 0 34 26" aria-hidden focusable="false">
      <path d="M3 22 L2 8 L9 13 L17 2 L25 13 L32 8 L31 22 Z" fill={THEME.gold} stroke={THEME.goldBright} strokeWidth="1" />
      <rect x="2" y="21" width="30" height="3" rx="1.2" fill={THEME.gold} stroke={THEME.goldBright} strokeWidth="0.5" />
      <circle cx="2" cy="8" r="2" fill={THEME.goldBright} />
      <circle cx="17" cy="2" r="2.3" fill={THEME.goldBright} />
      <circle cx="32" cy="8" r="2" fill={THEME.goldBright} />
    </svg>
  )
}

// A thin rule under the title with a small fleur-de-lis centered on it - echoes the board art's
// own fleur-de-lis corner ornaments (see CLAUDE.md) instead of a plain diamond.
function GoldDivider({ accent = false }: { accent?: boolean }) {
  if (!accent) {
    return <div style={{ width: '100%', height: 1, background: `linear-gradient(90deg, transparent, ${THEME.gold}, transparent)` }} />
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 8 }}>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${THEME.gold})` }} />
      <span style={{ color: THEME.gold, fontSize: 13, lineHeight: 1, flexShrink: 0 }} aria-hidden>⚜</span>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(270deg, transparent, ${THEME.gold})` }} />
    </div>
  )
}

// A subtle dark circular badge behind each button's icon, matching the reference's "icon in its
// own coin" look instead of the emoji sitting bare against the button's gradient.
const iconBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: '50%',
  background: 'rgba(0,0,0,0.28)',
  flexShrink: 0,
}

// Plain emoji (👥/🌐) rendered as a completely different, sometimes barely-recognizable glyph
// depending on the platform's own emoji font (reported directly - looked like a robot face rather
// than two people on the reporter's system). Custom SVGs render identically everywhere instead.
function PeopleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#eef4ff" aria-hidden focusable="false">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M9 12.5c-3.3 0-6 1.8-6 4v1.5h9.5V16.5c0-.7.2-1.4.6-2c-.9-1.2-2.4-2-4.1-2z" />
      <circle cx="16.3" cy="9" r="2.6" opacity="0.85" />
      <path d="M16.3 13c-1 0-1.9.3-2.6.8.9 1 1.4 2.3 1.4 3.7v1H21v-1.5c0-2-2.1-4-4.7-4z" opacity="0.85" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eef4ff" strokeWidth="1.7" aria-hidden focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.8 2.8 2.8 15.2 0 18M12 3c-2.8 2.8-2.8 15.2 0 18" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={THEME.cream} aria-hidden focusable="false">
      <path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Zm9.4 3.6c0 .5 0 1-.1 1.5l2.1 1.6-2 3.5-2.5-1a7.7 7.7 0 0 1-2.6 1.5l-.4 2.6H10.1l-.4-2.6a7.7 7.7 0 0 1-2.6-1.5l-2.5 1-2-3.5 2.1-1.6a8.2 8.2 0 0 1 0-3l-2.1-1.6 2-3.5 2.5 1a7.7 7.7 0 0 1 2.6-1.5L10.1 1h3.8l.4 2.6a7.7 7.7 0 0 1 2.6 1.5l2.5-1 2 3.5-2.1 1.6c.1.5.1 1 .1 1.5Z" />
    </svg>
  )
}

function HelpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eef4ff" strokeWidth="2" aria-hidden focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.3 9.3a2.7 2.7 0 1 1 3.9 2.4c-.8.4-1.2.9-1.2 1.8" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.9" fill="#eef4ff" stroke="none" />
    </svg>
  )
}

// Chunky carved-wood button, same physical-press recipe as the rest of the app (a solid, non-
// blurred offset bottom edge reads as depth, not a bigger blurred shadow) - now recolored per
// action: green for the local/offline action, burgundy for the online one, both trimmed in gold
// instead of the earlier flat single blue used for both.
// Reported directly (Carlos's own "life journey" philosophy - camaraderie over competition):
// online used to be a cold, corporate blue, the one clearly "cool-toned" swatch on an otherwise
// entirely warm screen. Burgundy (matches THEME.burgundy, #6e2430 - defined but never actually
// used anywhere until now) keeps the two actions just as visually distinct from each other, but
// both now read as warm, inviting choices rather than "the friendly one and the corporate one."
const TINTS = {
  green: ['#4c8c5c', '#256234', '#123d1c'],
  burgundy: ['#c98a94', '#6e2430', '#2e0e12'],
} as const

function buttonStyle(enabled: boolean, tint: keyof typeof TINTS): React.CSSProperties {
  const [light, mid, dark] = TINTS[tint]
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 'clamp(9px, 2vh, 22px) clamp(16px, 4vw, 42px)',
    fontSize: 'clamp(13px, 3.6vw, 23px)',
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

// Round gold-ring icon button, top-right - same medallion language as GameBoardScreen's own exit
// button, so a "corner icon button" reads consistently across the whole app.
const settingsButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 46,
  height: 46,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: `linear-gradient(180deg, rgba(255,255,255,0.14), transparent 45%), linear-gradient(165deg, ${THEME.green}f2, ${THEME.greenDeep}f7)`,
  border: `3px solid ${THEME.gold}`,
  borderRadius: '50%',
  boxShadow: `0 5px 0 ${THEME.goldDeep}, 0 9px 14px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.12)`,
  cursor: 'pointer',
}

const settingsOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.6)',
}

const settingsPanelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 14,
  padding: '26px 30px',
  borderRadius: 20,
  minWidth: 240,
}

const settingsRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 18px',
  fontSize: 16,
  fontWeight: 700,
  color: THEME.cream,
  background: `linear-gradient(165deg, ${THEME.greenLight}, ${THEME.green})`,
  border: `2px solid ${THEME.gold}`,
  borderRadius: 12,
  boxShadow: `0 4px 0 ${THEME.goldDeep}, 0 7px 10px rgba(0,0,0,0.35)`,
  cursor: 'pointer',
}

const settingsCloseStyle: React.CSSProperties = {
  padding: '10px 18px',
  fontSize: 14,
  fontWeight: 700,
  color: THEME.creamDim,
  background: 'transparent',
  border: `2px solid ${THEME.gold}66`,
  borderRadius: 999,
  cursor: 'pointer',
}
