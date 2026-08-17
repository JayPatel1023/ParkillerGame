import type { ReactNode, CSSProperties } from 'react'
import { THEME } from './theme'

// The one card shape reused everywhere a "premium tabletop" panel is needed - the start menu's
// title card, the in-game turn banner, player panels, the confirm-exit/winner dialogs - instead
// of every screen re-deriving its own dark-panel-with-a-border look. Dark green-to-black gradient,
// a thin gold border (recolorable via `accent`, e.g. to the current player's own color), and small
// corner ticks as a restrained stand-in for carved-wood corner ornaments.
export function GoldPanel({
  children,
  style,
  accent = THEME.gold,
  ticks = true,
}: {
  children: ReactNode
  style?: CSSProperties
  accent?: string
  ticks?: boolean
}) {
  return (
    <div
      style={{
        position: 'relative',
        background: `linear-gradient(180deg, rgba(255,255,255,0.05), transparent 30%), linear-gradient(165deg, ${THEME.green}f0, ${THEME.greenDeep}f7)`,
        border: `2px solid ${accent}`,
        borderRadius: 16,
        // The extra inset ring a few px in from the edge is a cheap stand-in for the reference's
        // double-line frame (an outer border plus a fainter inner one) without a second nested
        // element.
        boxShadow: `0 8px 24px rgba(0,0,0,0.55), inset 0 0 0 3px rgba(0,0,0,0.35), inset 0 0 0 6px ${accent}30, inset 0 1px 0 rgba(255,255,255,0.08)`,
        color: THEME.cream,
        fontFamily: 'system-ui, sans-serif',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {ticks && (
        <>
          <CornerTick corner="tl" color={accent} />
          <CornerTick corner="tr" color={accent} />
          <CornerTick corner="bl" color={accent} />
          <CornerTick corner="br" color={accent} />
        </>
      )}
      {children}
    </div>
  )
}

// A curled double-line flourish with a small dot at each tip, rotated per corner from one shared
// SVG - requested directly, side by side with a reference showing filigree-style corner ornaments
// instead of the earlier plain right-angle brackets.
function CornerTick({ corner, color }: { corner: 'tl' | 'tr' | 'bl' | 'br'; color: string }) {
  const base: CSSProperties = {
    position: 'absolute',
    width: 22,
    height: 22,
    pointerEvents: 'none',
    opacity: 0.9,
  }
  const placement: Record<string, CSSProperties> = {
    tl: { top: 2, left: 2, transform: 'rotate(0deg)' },
    tr: { top: 2, right: 2, transform: 'rotate(90deg)' },
    br: { bottom: 2, right: 2, transform: 'rotate(180deg)' },
    bl: { bottom: 2, left: 2, transform: 'rotate(270deg)' },
  }
  return (
    <svg viewBox="0 0 22 22" style={{ ...base, ...placement[corner] }} aria-hidden focusable="false">
      <path d="M1 15 C1 6 6 1 15 1" stroke={color} strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M1 9 C1 4 4 1 9 1" stroke={color} strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.6" />
      <circle cx="15" cy="1" r="1.5" fill={color} />
      <circle cx="1" cy="15" r="1.5" fill={color} />
    </svg>
  )
}
