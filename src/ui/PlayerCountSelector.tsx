import { StartScreenBackground } from '../scene/StartScreenBackground'

// Round "coin/token" shape instead of a rounded square - reported directly (with a screenshot)
// wanting a shape distinct from the rectangular action buttons elsewhere (Crear/Unirse/Jugar
// local), not just a different color. Circular reads as a selectable token/die face rather than a
// stretched-down version of the rectangular button language, while keeping the exact same
// material (glossy gradient + solid offset-edge depth) so it's still obviously part of the same
// set. Same background fix as StartScreen (see StartScreenBackground's own comment) - this screen
// still had the old flat, blurry image after that redesign, an inconsistency reported directly
// alongside the button-shape request.
// clamp()-sized: 5 buttons at a fixed 64px plus gaps already overflow a narrow phone's own width
// (reported directly, with a screenshot of the start screen clipping top/bottom on mobile - this
// screen has the same class of bug, just horizontal instead of vertical: 5*64 + 4*18 = 392px
// against a 375px-wide phone viewport). Shrinks smoothly with viewport width instead of a fixed
// breakpoint.
function countButtonStyle(): React.CSSProperties {
  return {
    width: 'clamp(46px, 14vw, 64px)',
    height: 'clamp(46px, 14vw, 64px)',
    fontSize: 'clamp(17px, 5vw, 24px)',
    fontWeight: 800,
    color: '#eef4ff',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0) 45%), linear-gradient(180deg, #dcebff 0%, #3d76e6 48%, #16409c 100%)',
    border: '3px solid #1a3468',
    borderRadius: '50%',
    boxShadow: '0 5px 0 #1a3468, 0 9px 14px rgba(0,0,0,0.4), inset 0 2px 1px rgba(255,255,255,0.55)',
    textShadow: '0 1px 2px rgba(8,16,40,0.5)',
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
            color: '#dce8ff',
            textShadow: '0 2px 0 #1a3468, 0 5px 12px rgba(0,0,0,0.55)',
            textAlign: 'center',
            padding: '0 12px',
          }}
        >
          ¿Cuántos jugadores?
        </h2>
        <div style={{ display: 'flex', gap: 'clamp(8px, 3vw, 18px)', padding: '0 12px' }}>
          {[2, 3, 4, 5, 6].map((count) => (
            <button key={count} className="chunky-btn" onClick={() => onConfirm(count)} style={countButtonStyle()}>
              {count}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
