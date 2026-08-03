import { useMemo } from 'react'
import type { BoardDefinition } from '../core/board/boardDefinition'
import { beginLocalGame } from '../core/gameFlow/localGameSession'
import type { PieceColor } from '../core/pieceColor'
import { getColor } from '../core/colorPalette'
import type { RewardReason } from '../core/gameFlow/turnManager'
import { useTurnManager } from '../hooks/useTurnManager'
import { BoardScene } from '../scene/BoardScene'

const BRAND_GOLD = '#ccb154'

function rewardReasonLabel(reason: RewardReason): string {
  return reason === 'capture' ? 'captura' : 'llegada a meta'
}

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
  const {
    currentPlayer,
    lastRoll,
    rolling,
    pendingMoves,
    winner,
    moveAnimation,
    eliminatedByDoubles,
    pendingReward,
    forfeitedReward,
    rollDice,
    chooseMove,
    clearMoveAnimation,
  } = useTurnManager(session.turnManager)

  const canRoll = pendingMoves.length === 0 && !winner && !rolling && !moveAnimation
  const diceValues: [number | null, number | null] = [lastRoll?.dieA ?? null, lastRoll?.dieB ?? null]
  const isDouble = lastRoll !== null && lastRoll.dieA === lastRoll.dieB

  return (
    <div className="game-screen-in" style={screenWrapperStyle}>
      <BoardScene
        definition={definition}
        players={session.players}
        pendingMoves={pendingMoves}
        onSelectPiece={chooseMove}
        diceValues={diceValues}
        rolling={rolling}
        onRollDice={() => canRoll && rollDice()}
        moveAnimation={moveAnimation}
        onAnimationComplete={clearMoveAnimation}
      />

      <div style={hudPanelStyle}>
        <div style={turnRowStyle}>
          <span style={{ ...turnDotStyle, background: getColor(currentPlayer.color) }} />
          <span style={{ fontWeight: 600, fontSize: 16 }}>Turno: {currentPlayer.color}</span>
        </div>
        {lastRoll && !rolling && (
          <div style={hintTextStyle}>
            Dados: {lastRoll.dieA} y {lastRoll.dieB}
            {isDouble && ' (dobles)'}
          </div>
        )}
        {eliminatedByDoubles && (
          <div style={{ ...hintTextStyle, color: '#e8a15c' }}>
            Tercer dobles seguido: {eliminatedByDoubles.color} pierde una ficha
          </div>
        )}
        {pendingReward && (
          <div style={{ ...hintTextStyle, color: '#7fd88f' }}>
            Recompensa: {pendingReward.amount} casillas ({rewardReasonLabel(pendingReward.reason)}) - elegí una ficha
          </div>
        )}
        {forfeitedReward && !pendingReward && (
          <div style={{ ...hintTextStyle, color: '#e8a15c' }}>
            Recompensa de {forfeitedReward.amount} casillas perdida (sin ficha disponible)
          </div>
        )}
        {pendingMoves.length > 0 && !pendingReward && <div style={hintTextStyle}>Elegí una ficha para mover</div>}
        <button onClick={() => canRoll && rollDice()} disabled={!canRoll} style={rollButtonStyle(canRoll)}>
          {rolling ? 'Rodando...' : 'Tirar dados'}
        </button>
      </div>

      <button onClick={onExit} title="Salir del juego" style={exitButtonStyle}>
        ✕ Salir
      </button>

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

const hudPanelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  background: 'rgba(30, 34, 30, 0.82)',
  border: `1px solid ${BRAND_GOLD}`,
  padding: '14px 18px',
  borderRadius: 10,
  fontFamily: 'system-ui, sans-serif',
  color: '#f2ede0',
  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
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
    padding: '9px 16px',
    fontSize: 15,
    fontWeight: 600,
    background: enabled ? BRAND_GOLD : '#5c5c54',
    color: enabled ? '#2a2a2a' : '#a8a8a0',
    border: 'none',
    borderRadius: 8,
    cursor: enabled ? 'pointer' : 'default',
  }
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
