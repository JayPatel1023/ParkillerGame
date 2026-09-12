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
// goes first.
//
// Reported directly ("debe de haber una tirada inicial para ver quien empieza" - there should be
// an initial roll to see who starts): the reveal above used to just print every already-decided
// roll at once, with no sense that a roll had actually happened. Each round now spins through
// random two-dice sums for a beat before settling on that round's real value - same "decided
// instantly, revealed with suspense" pattern ColorDrawModal already uses for its own color draw
// (see that file's own doc comment) - and a further tie-break round only starts spinning once the
// round before it has fully settled, so simultaneous ties don't all reveal at once either. The
// auto-dismiss timer now only starts once every round has settled, not from mount, so a multi-
// round tie-break can't get skipped out from under itself before it finishes revealing.
const BRAND_GOLD = '#c9a24b'
const SPIN_MS = 900
const SPIN_TICK_MS = 80
const PAUSE_BETWEEN_ROUNDS_MS = 500
const AUTO_DISMISS_MS = 4000

// Each real roll is the sum of *two* white dice (see startingPlayer.ts's own `dice.roll() +
// dice.roll()`), not a single 1-6 face - spinning through plain 1-6 values here would flash
// numbers the real roll could never land on.
function randomFace(): number {
  return 1 + Math.floor(Math.random() * 6)
}
function randomRollSum(): number {
  return randomFace() + randomFace()
}

export function StartingPlayerModal({ result, onDone }: { result: StartingPlayerResult; onDone: () => void }) {
  const [visible, setVisible] = useState(true)
  // How many rounds have fully settled on their real values so far - the round at this index is
  // the one currently spinning (if any remain).
  const [settledRounds, setSettledRounds] = useState(0)
  const [spinning, setSpinning] = useState(true)
  const [spinFaces, setSpinFaces] = useState<number[]>(() => result.rounds[0].map(randomRollSum))
  const allSettled = settledRounds >= result.rounds.length

  useEffect(() => {
    if (allSettled) return
    const round = result.rounds[settledRounds]
    setSpinFaces(round.map(randomRollSum))
    const tick = setInterval(() => setSpinFaces(round.map(randomRollSum)), SPIN_TICK_MS)
    const stopSpin = setTimeout(() => {
      clearInterval(tick)
      setSpinning(false)
    }, SPIN_MS)
    return () => {
      clearInterval(tick)
      clearTimeout(stopSpin)
    }
  }, [settledRounds, allSettled, result.rounds])

  useEffect(() => {
    if (spinning || allSettled) return
    const next = setTimeout(() => {
      setSettledRounds((n) => {
        const nextN = n + 1
        if (nextN < result.rounds.length) setSpinning(true)
        return nextN
      })
    }, PAUSE_BETWEEN_ROUNDS_MS)
    return () => clearTimeout(next)
  }, [spinning, allSettled, result.rounds.length])

  useEffect(() => {
    if (!allSettled) return
    const timer = setTimeout(() => setVisible(false), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [allSettled])

  useEffect(() => {
    if (!visible) onDone()
  }, [visible, onDone])

  if (!visible) return null

  // winnerIndex indexes into the *original* player list, not into the last round's own (possibly
  // smaller, tie-narrowed) subset - rounds[0] always covers every original player in that same
  // original order, so it's the only round guaranteed to still line up with winnerIndex directly.
  const winnerColor = result.rounds[0][result.winnerIndex]?.color

  return (
    <div style={backdropStyle} onClick={() => allSettled && setVisible(false)}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={titleStyle}>¿Quién empieza?</div>
        <div style={subtitleStyle}>Cada jugador tira los dados blancos</div>
        <div style={roundsStyle}>
          {result.rounds.slice(0, settledRounds + 1).map((round, roundIndex) => {
            const isCurrent = roundIndex === settledRounds && !allSettled
            return (
              <div key={roundIndex} style={roundStyle}>
                {roundIndex > 0 && <div style={tieLabelStyle}>Empate - se vuelve a tirar</div>}
                <div style={rowsStyle}>
                  {round.map((entry, i) => (
                    <div key={entry.color} style={{ ...rowStyle, ...(isCurrent && spinning ? rowSpinningStyle : undefined) }}>
                      <span style={{ ...dotStyle, background: getColor(entry.color) }} />
                      <span style={rollStyle}>{isCurrent && spinning ? spinFaces[i] : entry.roll}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        {allSettled && winnerColor && (
          <div style={winnerBannerStyle}>
            <span>Empieza:</span>
            <span style={{ ...dotStyle, background: getColor(winnerColor), width: 14, height: 14 }} />
          </div>
        )}
        <button className="chunky-btn" onClick={() => setVisible(false)} disabled={!allSettled} style={continueButtonStyle(!allSettled)}>
          Continuar
        </button>
      </div>
    </div>
  )
}

// See ColorDrawModal's own backdropStyle doc comment - same bleed-through bug, same fix. Online
// play shows this modal right after that one, over a board that's been live since before either
// one mounted (bridge.start() already ran in OnlineLobbyScreen.tsx) - a translucent backdrop let
// that first move visibly play out through it, exactly what was reported.
const backdropStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#05070c',
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

// Brighter border on whichever row is still spinning through random faces, so it's clear which
// round the flickering numbers belong to once a tie narrows the field to fewer rows.
const rowSpinningStyle: React.CSSProperties = {
  border: `1.5px solid ${BRAND_GOLD}`,
  boxShadow: `0 0 8px ${BRAND_GOLD}66`,
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

const continueButtonStyle = (disabled: boolean): React.CSSProperties => ({
  marginTop: 4,
  padding: '10px 28px',
  fontSize: 14,
  fontWeight: 700,
  opacity: disabled ? 0.5 : 1,
  cursor: disabled ? 'default' : 'pointer',
})
