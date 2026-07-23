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
        background: '#b5cbb8',
        color: '#2a2a2a',
      }}
    >
      <h2>¿Cuántos jugadores?</h2>
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
