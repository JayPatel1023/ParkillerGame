// Same chunky carved-wood button language as StartScreen.tsx's own redesign, reused here (not
// duplicated as a full copy) since this screen sits directly between StartScreen and the game -
// keeping the earlier flat circular buttons here would have made the setup flow visually
// inconsistent mid-flow instead of consistent start-to-finish.
function countButtonStyle(): React.CSSProperties {
  return {
    width: 68,
    height: 68,
    fontSize: 26,
    fontWeight: 800,
    color: '#4a2e12',
    background: 'linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0) 40%), linear-gradient(180deg, #ffe08a 0%, #ecb84a 55%, #d9982e 100%)',
    border: '3px solid #8a5a1e',
    borderRadius: 16,
    boxShadow: '0 5px 0 #8a5a1e, 0 9px 14px rgba(0,0,0,0.4), inset 0 2px 1px rgba(255,255,255,0.55)',
    textShadow: '0 1px 0 rgba(255,255,255,0.35)',
    cursor: 'pointer',
  }
}

export function PlayerCountSelector({ onConfirm }: { onConfirm: (count: number) => void }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        color: '#f2ede0',
        backgroundImage:
          'radial-gradient(ellipse at center, rgba(20,14,6,0.15) 0%, rgba(15,10,5,0.6) 100%), url(/backgrounds/start-bg.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <h2
        style={{
          fontSize: 30,
          fontWeight: 800,
          margin: 0,
          letterSpacing: 1,
          color: '#ffe9b8',
          textShadow: '0 2px 0 #8a5a1e, 0 5px 12px rgba(0,0,0,0.55)',
        }}
      >
        ¿Cuántos jugadores?
      </h2>
      <div style={{ display: 'flex', gap: 16 }}>
        {[2, 3, 4, 5, 6].map((count) => (
          <button key={count} onClick={() => onConfirm(count)} style={countButtonStyle()}>
            {count}
          </button>
        ))}
      </div>
    </div>
  )
}
