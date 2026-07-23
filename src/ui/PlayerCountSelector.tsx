export function PlayerCountSelector({ onConfirm }: { onConfirm: (count: number) => void }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        color: '#f2ede0',
        backgroundImage: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.45) 100%), url(/backgrounds/start-bg.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <h2 style={{ textShadow: '0 2px 10px rgba(0,0,0,0.6)' }}>¿Cuántos jugadores?</h2>
      <div style={{ display: 'flex', gap: 12 }}>
        {[2, 3, 4, 5, 6].map((count) => (
          <button
            key={count}
            onClick={() => onConfirm(count)}
            style={{ width: 56, height: 56, fontSize: 20, borderRadius: '50%', border: 'none', background: '#ccb154' }}
          >
            {count}
          </button>
        ))}
      </div>
    </div>
  )
}
