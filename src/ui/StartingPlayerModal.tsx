import { useEffect, useState } from 'react'
import { getColor } from '../core/colorPalette'
import type { StartingPlayerResult } from '../core/gameFlow/startingPlayer'

// Requested directly ("para empezar la partida cada jugador y los bots lanzan los dados blancos
// para indicar quien comienza la partida" - to start the game, every player and the bots roll the
// white dice to decide who goes first): the game previously always started with whichever color
// was listed first, silently, with nothing on screen showing why. This is a one-time reveal shown
// right when GameBoardScreen mounts (the roll-off itself already happened synchronously inside
// beginLocalGame, before this component even exists - see startingPlayer.ts) - every player's own
// roll, round by round (a further round only ever appears on a tie), ending on whoever actually
// goes first. Auto-dismisses on its own after a few seconds, same as it would if the player just
// tapped past it - nothing about game state depends on this actually being watched.
const BRAND_GOLD = '#c9a24b'
const AUTO_DISMISS_MS = 4000

export function StartingPlayerModal({ result, onDone }: { result: StartingPlayerResult; onDone: () => void }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!visible) onDone()
  }, [visible, onDone])

  if (!visible) return null

  // winnerIndex indexes into the *original* player list, not into the last round's own (possibly
  // smaller, tie-narrowed) subset - rounds[0] always covers every original player in that same
  // original order, so it's the only round guaranteed to still line up with winnerIndex directly.
  const winnerColor = result.rounds[0][result.winnerIndex]?.color

  return (
    <div style={backdropStyle} onClick={() => setVisible(false)}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={titleStyle}>¿Quién empieza?</div>
        <div style={subtitleStyle}>Cada jugador tira los dados blancos</div>
        <div style={roundsStyle}>
          {result.rounds.map((round, roundIndex) => (
            <div key={roundIndex} style={roundStyle}>
              {roundIndex > 0 && <div style={tieLabelStyle}>Empate - se vuelve a tirar</div>}
              <div style={rowsStyle}>
                {round.map((entry) => (
                  <div key={entry.color} style={rowStyle}>
                    <span style={{ ...dotStyle, background: getColor(entry.color) }} />
                    <span style={rollStyle}>{entry.roll}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {winnerColor && (
          <div style={winnerBannerStyle}>
            <span>Empieza:</span>
            <span style={{ ...dotStyle, background: getColor(winnerColor), width: 14, height: 14 }} />
          </div>
        )}
        <button className="chunky-btn" onClick={() => setVisible(false)} style={continueButtonStyle}>
          Continuar
        </button>
      </div>
    </div>
  )
}

const backdropStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.6)',
  zIndex: 25,
  padding: 16,
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  width: 'min(360px, 100%)',
  padding: '22px 24px',
  borderRadius: 20,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent 20%), linear-gradient(165deg, rgba(58, 46, 30, 0.97), rgba(24, 18, 11, 0.97))',
  border: `3px solid ${BRAND_GOLD}`,
  boxShadow: '0 16px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12)',
}

const titleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  color: '#f2ede0',
  letterSpacing: 0.5,
}

const subtitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#c9bda3',
  marginTop: -6,
}

const roundsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: '100%',
}

const roundStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

const tieLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#c9bda3',
  textAlign: 'center',
}

const rowsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: 8,
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  borderRadius: 999,
  background: 'rgba(0,0,0,0.3)',
  border: `1.5px solid ${BRAND_GOLD}55`,
}

const dotStyle: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  flexShrink: 0,
  boxShadow: '0 0 4px rgba(0,0,0,0.5)',
}

const rollStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: '#f2ede0',
}

const winnerBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 15,
  fontWeight: 700,
  color: '#f2ede0',
}

const continueButtonStyle: React.CSSProperties = {
  marginTop: 4,
  padding: '10px 28px',
  fontSize: 14,
  fontWeight: 700,
}
