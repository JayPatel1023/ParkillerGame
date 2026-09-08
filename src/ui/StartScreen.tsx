import { useState } from 'react'
import { GoldPanel } from './GoldPanel'
import { isMusicMuted, toggleMusicMuted } from './introMusic'
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
  // Reported directly: the app had no settings entry point at all. Originally kept to exactly one
  // item (Ayuda) rather than inventing placeholder rows (sound/language toggles etc.) with no real
  // functionality behind them yet - a real music toggle now exists (introMusic.ts, requested
  // directly: "habría que ponerle alguna música a la introducción del juego"), so it earns its own
  // row here instead of staying a placeholder.
  const [showSettings, setShowSettings] = useState(false)
  const [musicMuted, setMusicMuted] = useState(isMusicMuted)
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
          {/* Reported directly, with reference screenshots of both buttons: use these exact
              button images instead of the coded gradient+icon+text recipe above (still used
              elsewhere - settings rows, GameBoardScreen, etc. - only these two are replaced).
              Both source screenshots had the same baked-in-checkerboard issue as this session's
              other supplied art (looks transparent, isn't - alpha channel present but uniformly
              255) - cut out with a precise rounded-rect mask (measured directly off each button's
              own pixel edges) rather than a flood-fill, since a clean rectangle has no irregular-
              silhouette leak risk the way a character illustration would. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(7px, 1.8vh, 18px)', width: 'min(360px, 72vw)', marginTop: 'clamp(2px, 0.8vh, 10px)' }}>
            <button className="chunky-btn chunky-btn-pulse" onClick={onPlayLocal} style={imageButtonStyle(true)}>
              <img src="/jugar-local-btn.png" alt="Jugar local - En el mismo dispositivo" style={imageButtonImgStyle} />
            </button>
            <button
              className="chunky-btn"
              disabled={!canPlayOnline}
              title={canPlayOnline ? undefined : 'Falta configurar VITE_PHOTON_APP_ID'}
              onClick={() => (window.location.hash = '#online')}
              style={imageButtonStyle(canPlayOnline)}
            >
              <img src="/jugar-online-btn.png" alt="Jugar online - Conecta con tus amigos" style={imageButtonImgStyle} />
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
            <button className="chunky-btn" onClick={() => setMusicMuted(toggleMusicMuted())} style={settingsRowStyle}>
              <span aria-hidden style={iconBadgeStyle}>{musicMuted ? <MusicOffIcon /> : <MusicOnIcon />}</span>
              {musicMuted ? 'Música: apagada' : 'Música: encendida'}
            </button>
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

function MusicOnIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#eef4ff" aria-hidden focusable="false">
      <circle cx="6.5" cy="18" r="3.2" />
      <circle cx="17" cy="15.5" r="3.2" />
      <path d="M9.7 18V5.2L20.2 3v12.5" stroke="#eef4ff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MusicOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#eef4ff" aria-hidden focusable="false">
      <circle cx="6.5" cy="18" r="3.2" opacity="0.5" />
      <circle cx="17" cy="15.5" r="3.2" opacity="0.5" />
      <path d="M9.7 18V5.2L20.2 3v12.5" stroke="#eef4ff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
      <path d="M3 3l18 18" stroke="#eef4ff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

// Wrapper for the two image buttons above - the images themselves already carry the full visual
// design (gradient, border, icon, text, subtitle, chevron), so this just needs to be an
// unstyled, full-width click target. Disabled state (only ever the online button, when
// VITE_PHOTON_APP_ID isn't configured) has no dedicated art, so it's simulated with a filter -
// desaturated and dimmed rather than swapped for a coded fallback that wouldn't match the art's
// own style.
function imageButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    padding: 0,
    border: 'none',
    background: 'transparent',
    cursor: enabled ? 'pointer' : 'default',
    filter: enabled ? 'none' : 'grayscale(0.85) brightness(0.6)',
  }
}

const imageButtonImgStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  height: 'auto',
  filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.45))',
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
