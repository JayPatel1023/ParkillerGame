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
        boxShadow: '0 8px 24px rgba(0,0,0,0.55), inset 0 0 0 3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
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

function CornerTick({ corner, color }: { corner: 'tl' | 'tr' | 'bl' | 'br'; color: string }) {
  const base: CSSProperties = {
    position: 'absolute',
    width: 16,
    height: 16,
    pointerEvents: 'none',
    opacity: 0.9,
  }
  const edges: Record<string, CSSProperties> = {
    tl: { top: -2, left: -2, borderTop: `2px solid ${color}`, borderLeft: `2px solid ${color}`, borderTopLeftRadius: 6 },
    tr: { top: -2, right: -2, borderTop: `2px solid ${color}`, borderRight: `2px solid ${color}`, borderTopRightRadius: 6 },
    bl: { bottom: -2, left: -2, borderBottom: `2px solid ${color}`, borderLeft: `2px solid ${color}`, borderBottomLeftRadius: 6 },
    br: { bottom: -2, right: -2, borderBottom: `2px solid ${color}`, borderRight: `2px solid ${color}`, borderBottomRightRadius: 6 },
  }
  return <span style={{ ...base, ...edges[corner] }} />
}
