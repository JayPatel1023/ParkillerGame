import { useMemo, useState } from 'react'
import type { BoardDefinition } from '../core/board/boardDefinition'
import { beginLocalGame } from '../core/gameFlow/localGameSession'
import type { PieceColor } from '../core/pieceColor'
import { getColor } from '../core/colorPalette'
import { useTurnManager } from '../hooks/useTurnManager'
import { BoardScene } from '../scene/BoardScene'
import { RewardToast } from './RewardToast'

const BRAND_GOLD = '#ccb154'

export function GameBoardScreen({
  definition,
  colors,
  onExit,
}: {
  definition: BoardDefinition
  colors: PieceColor[]
  onExit: () => void
}) {
  const session = useMemo(() => beginLocalGame(definition, colors), [definition, colors])
  // A live game (turns, dice, positions) is real in-progress state a stray click shouldn't be able
  // to throw away - confirm before actually leaving instead of exiting immediately on one click.
  const [confirmingExit, setConfirmingExit] = useState(false)
  const {
    currentPlayer,
    lastRoll,
    rolling,
    pendingMoves,
    winner,
    moveAnimation,
    parkillerAnimation,
    eliminatedByDoubles,
    pendingReward,
    forfeitedReward,
    rollDice,
    chooseMove,
    clearMoveAnimation,
    clearParkillerAnimation,
  } = useTurnManager(session.turnManager)

  const canRoll = pendingMoves.length === 0 && !winner && !rolling && !moveAnimation
  const diceValues: [number | null, number | null, number | null] = [
    lastRoll?.dieA ?? null,
    lastRoll?.dieB ?? null,
    lastRoll?.blackDie ?? null,
  ]
  const isDouble = lastRoll !== null && lastRoll.dieA === lastRoll.dieB

  return (
    <div className="game-screen-in" style={screenWrapperStyle}>
      <BoardScene
        definition={definition}
        players={session.players}
        pendingMoves={pendingMoves}
        onSelectPiece={chooseMove}
        currentPlayerColor={currentPlayer.color}
        diceValues={diceValues}
        rolling={rolling}
        onRollDice={() => canRoll && rollDice()}
        moveAnimation={moveAnimation}
        onAnimationComplete={clearMoveAnimation}
        parkillerAnimation={parkillerAnimation}
        onParkillerAnimationComplete={clearParkillerAnimation}
      />

      <RewardToast pendingReward={pendingReward} forfeitedReward={forfeitedReward} />

      <div style={hudPanelStyle}>
        <div style={turnRowStyle}>
          <span style={{ ...turnDotStyle, background: getColor(currentPlayer.color) }} />
          <span style={{ fontWeight: 600, fontSize: 16 }}>Turno: {currentPlayer.color}</span>
        </div>
        {lastRoll && !rolling && (
          <div style={hintTextStyle}>
            Dados: {lastRoll.dieA} y {lastRoll.dieB}
            {isDouble && ' (dobles)'} · Parkiller: {lastRoll.blackDie}
          </div>
        )}
        {eliminatedByDoubles && (
          <div style={{ ...hintTextStyle, color: '#e8a15c' }}>
            Tercer dobles seguido: {eliminatedByDoubles.color} pierde una ficha
          </div>
        )}
        {/* The reward amount/reason itself is now the celebratory RewardToast (center-stage,
            animated) instead of a small status line here - this just keeps the player moving
            forward with what to actually click next. */}
        {pendingReward && <div style={{ ...hintTextStyle, color: '#7fd88f' }}>Elegí una ficha para tu recompensa</div>}
        {pendingMoves.length > 0 && !pendingReward && <div style={hintTextStyle}>Elegí una ficha para mover</div>}
        <button onClick={() => canRoll && rollDice()} disabled={!canRoll} style={rollButtonStyle(canRoll)}>
          {rolling ? 'Rodando...' : 'Tirar dados'}
        </button>
      </div>

      <button onClick={() => setConfirmingExit(true)} title="Salir del juego" style={exitButtonStyle}>
        ✕ Salir
      </button>

      {confirmingExit && (
        <div style={overlayStyle}>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#f2ede0' }}>¿Seguro que querés salir?</div>
          <div style={{ ...hintTextStyle, marginBottom: 4 }}>Se perderá la partida en curso.</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setConfirmingExit(false)} style={secondaryButtonStyle}>
              Cancelar
            </button>
            <button onClick={onExit} style={rollButtonStyle(true)}>
              Sí, salir
            </button>
          </div>
        </div>
      )}

      {winner && (
        <div style={overlayStyle}>
          <div style={{ color: getColor(winner.color), fontSize: 32, fontWeight: 'bold' }}>¡{winner.color} gana!</div>
          <button onClick={onExit} style={{ ...rollButtonStyle(true), marginTop: 8 }}>
            Volver al inicio
          </button>
        </div>
      )}
    </div>
  )
}

// A square board inside a landscape window always leaves margin beside it - no zoom/fit math
// changes that geometry. Rather than fight it, give that margin a deliberate look (a soft radial
// glow in the board's own parchment/gold tones fading to the page's dark ground) so it reads as
// framing the board, not as empty unstyled space around it.
const screenWrapperStyle: React.CSSProperties = {
  height: '100%',
  position: 'relative',
  background: 'radial-gradient(ellipse at center, rgba(181, 203, 184, 0.16) 0%, rgba(28, 31, 29, 0) 62%)',
}

// Reported directly: the whole game felt too serious/stiff, not the "relajado, divertido" feel a
// casual board game should have - warmer panel tone (a soft brown instead of flat near-black) and
// rounder corners are a first, low-risk step in that direction alongside the new RewardToast.
const hudPanelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  background: 'linear-gradient(165deg, rgba(58, 46, 30, 0.88), rgba(38, 30, 20, 0.88))',
  border: `1px solid ${BRAND_GOLD}`,
  padding: '14px 18px',
  borderRadius: 16,
  fontFamily: 'system-ui, sans-serif',
  color: '#f2ede0',
  boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
  minWidth: 160,
}

const turnRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const turnDotStyle: React.CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: '50%',
  boxShadow: '0 0 6px rgba(0,0,0,0.5)',
  flexShrink: 0,
}

const hintTextStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#d8d2c2',
}

function rollButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    padding: '10px 18px',
    fontSize: 15,
    fontWeight: 700,
    background: enabled ? 'linear-gradient(165deg, #ffe08a, #ccb154)' : '#5c5c54',
    color: enabled ? '#2a2210' : '#a8a8a0',
    border: 'none',
    borderRadius: 14,
    boxShadow: enabled ? '0 3px 10px rgba(204, 177, 84, 0.35)' : 'none',
    cursor: enabled ? 'pointer' : 'default',
  }
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '9px 16px',
  fontSize: 15,
  fontWeight: 600,
  background: 'transparent',
  color: '#f2ede0',
  border: `1px solid ${BRAND_GOLD}`,
  borderRadius: 8,
  cursor: 'pointer',
}

const exitButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  padding: '8px 14px',
  fontSize: 14,
  fontWeight: 600,
  background: 'rgba(30, 34, 30, 0.82)',
  border: `1px solid ${BRAND_GOLD}`,
  borderRadius: 8,
  color: '#f2ede0',
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  background: 'rgba(0,0,0,0.55)',
}
