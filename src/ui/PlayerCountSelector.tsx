import { StartScreenBackground } from '../scene/StartScreenBackground'

function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const clamp = (c: number) => Math.max(0, Math.min(255, c))
  const r = clamp(((n >> 16) & 0xff) + Math.round(255 * amount))
  const g = clamp(((n >> 8) & 0xff) + Math.round(255 * amount))
  const b = clamp((n & 0xff) + Math.round(255 * amount))
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

// clamp()-sized: 5 buttons at a fixed 64px plus gaps already overflow a narrow phone's own width
// (reported directly, with a screenshot of the start screen clipping top/bottom on mobile - this
// screen has the same class of bug, just horizontal instead of vertical: 5*64 + 4*18 = 392px
// against a 375px-wide phone viewport). Shrinks smoothly with viewport width instead of a fixed
// breakpoint.
//
// Reported directly, twice: first that these read as a cold competitive-blue chip (recolored
// warm gold), then - still not distinct enough sitting on the board's own similarly-toned gold
// yard circles - asked for a genuinely different shape and feel entirely, explicitly "playful,
// for a child's sense of wonder" rather than another variation on the app's usual premium-
// tabletop chrome. A full candy-jar redesign: a rounded-square "gumdrop" instead of a coin,
// one bright, fully saturated color per button (a real rainbow across the row, not five shades of
// one hue) with a thick white border - the "wooden toy / candy button" language, nothing else in
// this app uses - plus the wobble/bounce this file's own JSX wires up via .candy-btn
// (see index.css's own candy-wobble comment for why idle motion specifically, not just color).
const CANDY_COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7']

function countButtonStyle(colorHex: string): React.CSSProperties {
  const light = lighten(colorHex, 0.35)
  const dark = lighten(colorHex, -0.3)
  return {
    width: 'clamp(48px, 15vw, 68px)',
    height: 'clamp(48px, 15vw, 68px)',
    fontSize: 'clamp(18px, 5.2vw, 26px)',
    fontWeight: 900,
    color: '#ffffff',
    background: `radial-gradient(circle at 32% 26%, ${light} 0%, ${colorHex} 55%, ${dark} 100%)`,
    border: '4px solid #fffaf0',
    borderRadius: '30%',
    boxShadow: `0 6px 0 ${dark}, 0 10px 16px rgba(0,0,0,0.35), inset 0 3px 3px rgba(255,255,255,0.7)`,
    textShadow: '0 2px 0 rgba(0,0,0,0.25)',
    cursor: 'pointer',
    flexShrink: 0,
  }
}

export function PlayerCountSelector({ onConfirm }: { onConfirm: (count: number) => void }) {
  return (
    <div style={{ height: '100%', position: 'relative' }}>
      {/* backgroundColor here matches StartScreenBackground's own internal fog color exactly - see
          that component's own doc comment for why: this screen renders a real WebGL <Canvas>, and
          a canvas that's slow to initialize (or fails outright - a stale/lost context after
          repeated screen navigation, in particular) used to leave nothing behind it at all, reading
          as a plain black screen with no board. Matching the fog tone means a slow-but-successful
          load is seamless (no color flash once the canvas does paint), and a failed one still shows
          an intentional dark background instead of true emptiness. */}
      <div style={{ position: 'absolute', inset: 0, backgroundColor: '#05070c' }}>
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
          gap: 28,
          color: '#f2ede0',
        }}
      >
        <h2
          style={{
            fontSize: 'clamp(22px, 6vw, 30px)',
            fontWeight: 800,
            margin: 0,
            letterSpacing: 1,
            color: '#e8cf8a',
            textShadow: '0 2px 0 #7a5f26, 0 5px 12px rgba(0,0,0,0.55)',
            textAlign: 'center',
            padding: '0 12px',
          }}
        >
          ¿Cuántos jugadores?
        </h2>
        <div style={{ display: 'flex', gap: 'clamp(8px, 3vw, 18px)', padding: '0 12px' }}>
          {[2, 3, 4, 5, 6].map((count, i) => (
            <button
              key={count}
              className="chunky-btn candy-btn"
              onClick={() => onConfirm(count)}
              style={{ ...countButtonStyle(CANDY_COLORS[i]), ['--wobble-delay' as string]: `${i * 0.15}s` }}
            >
              {count}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
