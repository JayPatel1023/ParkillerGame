import { StartScreenBackground } from '../scene/StartScreenBackground'
import { GoldPanel } from './GoldPanel'
import { THEME } from './theme'

// Round "coin/token" shape - reported directly wanting a shape distinct from the rectangular
// action buttons elsewhere (Jugar local/online), not just a different color. Recolored from the
// earlier blue to the gold/deep-green palette shared with the rest of the app now (see theme.ts).
// clamp()-sized: 5 buttons at a fixed 64px plus gaps already overflow a narrow phone's own width.
function countButtonStyle(): React.CSSProperties {
  return {
    width: 'clamp(46px, 14vw, 64px)',
    height: 'clamp(46px, 14vw, 64px)',
    fontSize: 'clamp(17px, 5vw, 24px)',
    fontWeight: 800,
    color: THEME.cream,
    background: `linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0) 45%), linear-gradient(180deg, ${THEME.greenLight} 0%, ${THEME.green} 55%, ${THEME.greenDeep} 100%)`,
    border: `3px solid ${THEME.gold}`,
    borderRadius: '50%',
    boxShadow: `0 5px 0 ${THEME.goldDeep}, 0 9px 14px rgba(0,0,0,0.4), inset 0 2px 1px rgba(255,255,255,0.3)`,
    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
    cursor: 'pointer',
    flexShrink: 0,
  }
}

export function PlayerCountSelector({ onConfirm }: { onConfirm: (count: number) => void }) {
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
      <div style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box' }}>
        <GoldPanel
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'clamp(20px, 4vh, 30px)',
            padding: 'clamp(24px, 5vh, 36px) clamp(20px, 6vw, 40px)',
            borderRadius: 22,
            maxWidth: '92vw',
          }}
        >
          <h2
            style={{
              fontSize: 'clamp(20px, 5.5vw, 26px)',
              fontWeight: 800,
              margin: 0,
              letterSpacing: 1,
              color: THEME.goldBright,
              textShadow: '0 2px 8px rgba(0,0,0,0.5)',
              textAlign: 'center',
            }}
          >
            ¿Cuántos jugadores?
          </h2>
          <div style={{ display: 'flex', gap: 'clamp(8px, 3vw, 18px)', flexWrap: 'wrap', justifyContent: 'center' }}>
            {[2, 3, 4, 5, 6].map((count) => (
              <button key={count} className="chunky-btn" onClick={() => onConfirm(count)} style={countButtonStyle()}>
                {count}
              </button>
            ))}
          </div>
        </GoldPanel>
      </div>
    </div>
  )
}
