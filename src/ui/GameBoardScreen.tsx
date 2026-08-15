import { useState } from 'react'
import type { BoardDefinition } from '../core/board/boardDefinition'
import type { PlayerState } from '../core/gameFlow/playerState'
import { getColor } from '../core/colorPalette'
import type { TurnManagerLike } from '../core/gameFlow/turnManagerLike'
import { useTurnManager } from '../hooks/useTurnManager'
import { BoardScene } from '../scene/BoardScene'
import { RewardToast } from './RewardToast'

const BRAND_GOLD = '#ccb154'

/** A local game builds this via beginLocalGame (src/core/gameFlow/localGameSession.ts); an online
 * game builds it from a HostTurnManagerBridge/RemoteTurnManager (src/online/) plus the players
 * assigned to that room's seats - this screen only ever depends on the TurnManagerLike surface,
 * not which kind of session produced it. */
export interface GameSession {
  turnManager: TurnManagerLike
  players: PlayerState[]
}

export function GameBoardScreen({
  definition,
  session,
  onExit,
}: {
  definition: BoardDefinition
  session: GameSession
  onExit: () => void
}) {
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
        ✕
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

// Reported directly (twice now): the whole game felt too serious/stiff, not the "relajado,
// divertido" feel a casual board game should have. First pass (warmer panel tone, rounder
// corners) wasn't enough on its own - the shapes underneath were still plain rectangles, which
// reads as a form/dialog box rather than part of a game. This pass goes further: a double-ring
// "medallion" border (an outer gold ring plus an inset darker ring, the same layered-border trick
// real board-game components use) instead of one flat line, rounder corners, and a soft top-edge
// highlight for a lacquered/varnished feel matching the pieces' own glossy clearcoat material -
// so the panel reads as a carved game token sitting on the table, not a UI card floating over it.
const hudPanelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  background:
    'linear-gradient(180deg, rgba(255,255,255,0.06), transparent 30%), linear-gradient(165deg, rgba(64, 50, 32, 0.92), rgba(36, 28, 18, 0.92))',
  border: `2px solid ${BRAND_GOLD}`,
  boxShadow: `0 6px 20px rgba(0,0,0,0.4), inset 0 0 0 3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)`,
  padding: '16px 20px',
  borderRadius: 22,
  fontFamily: 'system-ui, sans-serif',
  color: '#f2ede0',
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

// Full pill shape (borderRadius 999) instead of a lightly-rounded rectangle, plus a glossy
// top-highlight layer over the gold gradient - the same "glass-like sheen over a solid color"
// recipe the 3D pieces use (see PieceMesh/ParkillerMesh's clearcoat material), so the game's most-
// pressed button reads as a tactile, lacquered token rather than a flat web button.
function rollButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    padding: '12px 22px',
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: 0.3,
    background: enabled
      ? 'linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0) 45%), linear-gradient(165deg, #ffe08a, #ccb154)'
      : 'linear-gradient(165deg, #6b6b62, #4a4a44)',
    color: enabled ? '#3a2c10' : '#9a9a90',
    border: `2px solid ${enabled ? '#8a6d2a' : '#3a3a34'}`,
    borderRadius: 999,
    boxShadow: enabled
      ? '0 4px 12px rgba(204, 177, 84, 0.4), inset 0 1px 1px rgba(255,255,255,0.6), inset 0 -2px 3px rgba(120, 90, 20, 0.35)'
      : 'inset 0 1px 2px rgba(0,0,0,0.3)',
    cursor: enabled ? 'pointer' : 'default',
    transition: 'transform 0.08s ease, box-shadow 0.08s ease',
  }
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '11px 20px',
  fontSize: 15,
  fontWeight: 600,
  background: 'linear-gradient(165deg, rgba(255,255,255,0.08), rgba(255,255,255,0) 60%)',
  color: '#f2ede0',
  border: `2px solid ${BRAND_GOLD}`,
  borderRadius: 999,
  boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.15)',
  cursor: 'pointer',
}

// Round medallion badge instead of a rectangular "Salir" pill - matches the fleur-de-lis/star
// corner ornaments already painted into the board art, and clears the boxy dead space a text
// button left in the corner (reported directly, alongside the panel/roll-button shapes).
const exitButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 44,
  height: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 16,
  fontWeight: 700,
  background:
    'linear-gradient(180deg, rgba(255,255,255,0.18), transparent 45%), linear-gradient(165deg, rgba(64, 50, 32, 0.92), rgba(36, 28, 18, 0.92))',
  border: `2px solid ${BRAND_GOLD}`,
  borderRadius: '50%',
  boxShadow: '0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.12)',
  color: '#f2ede0',
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
  lineHeight: 1,
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
