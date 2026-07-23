import { useMemo } from 'react'
import type { BoardDefinition } from '../core/board/boardDefinition'
import { beginLocalGame } from '../core/gameFlow/localGameSession'
import type { PieceColor } from '../core/pieceColor'
import { getColor } from '../core/colorPalette'
import { useTurnManager } from '../hooks/useTurnManager'
import { BoardScene } from '../scene/BoardScene'

export function GameBoardScreen({ definition, colors }: { definition: BoardDefinition; colors: PieceColor[] }) {
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

      <div style={hudStyle}>
        <div style={{ color: getColor(currentPlayer.color), fontWeight: 'bold', fontSize: 18 }}>
          Turno: {currentPlayer.color}
        </div>
        {pendingMoves.length > 0 && <div>Elegí una ficha para mover</div>}
        <button onClick={() => canRoll && rollDice()} disabled={!canRoll} style={{ marginTop: 8, padding: '8px 16px' }}>
          {rolling ? 'Rodando...' : 'Tirar dado'}
        </button>
      </div>

      {winner && (
        <div style={overlayStyle}>
          <div style={{ color: getColor(winner.color), fontSize: 32, fontWeight: 'bold' }}>
            ¡{winner.color} gana!
          </div>
        </div>
      )}
    </div>
  )
}

const hudStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  background: 'rgba(255,255,255,0.85)',
  padding: '10px 14px',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.55)',
}
