import { useMemo } from 'react'
import type { BoardDefinition } from '../core/board/boardDefinition'
import { beginLocalGame } from '../core/gameFlow/localGameSession'
import type { PieceColor } from '../core/pieceColor'
import { getColor } from '../core/colorPalette'
import { useTurnManager } from '../hooks/useTurnManager'
import { BoardScene } from '../scene/BoardScene'

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
  const { currentPlayer, lastRoll, rolling, pendingMoves, winner, moveAnimation, rollDice, chooseMove, clearMoveAnimation } =
    useTurnManager(session.turnManager)

  const canRoll = pendingMoves.length === 0 && !winner && !rolling && !moveAnimation

  return (
    <div style={{ height: '100%', position: 'relative' }}>
      <BoardScene
        definition={definition}
        players={session.players}
        pendingMoves={pendingMoves}
        onSelectPiece={chooseMove}
        diceValue={lastRoll}
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
        {pendingMoves.length > 0 && <div style={hintTextStyle}>Elegí una ficha para mover</div>}
        <button onClick={() => canRoll && rollDice()} disabled={!canRoll} style={rollButtonStyle(canRoll)}>
          {rolling ? 'Rodando...' : 'Tirar dado'}
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
