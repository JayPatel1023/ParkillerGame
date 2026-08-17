import { useEffect, useState } from 'react'
import type { BoardDefinition } from '../core/board/boardDefinition'
import type { PlayerState } from '../core/gameFlow/playerState'
import { getColor } from '../core/colorPalette'
import type { TurnManagerLike } from '../core/gameFlow/turnManagerLike'
import { useTurnManager } from '../hooks/useTurnManager'
import { BoardScene } from '../scene/BoardScene'
import { Confetti } from './Confetti'
import { RewardToast } from './RewardToast'

const BRAND_GOLD = '#4a78d8'

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

  // Idle nudge: reported directly - a player who steps away or just spaces out mid-turn leaves
  // everyone else staring at a board that never visibly asks for input. Restarts whenever canRoll
  // flips (a fresh chance to roll appeared, or this one just got used/left) or the turn itself
  // changes, so it can't fire mid-roll or carry over onto the next player's turn.
  const IDLE_NUDGE_MS = 60_000
  const [nudgeDice, setNudgeDice] = useState(false)
  useEffect(() => {
    setNudgeDice(false)
    if (!canRoll) return
    const timer = setTimeout(() => setNudgeDice(true), IDLE_NUDGE_MS)
    return () => clearTimeout(timer)
  }, [canRoll, currentPlayer.color])

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
        nudgeDice={nudgeDice}
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
        <button className="chunky-btn" onClick={() => canRoll && rollDice()} disabled={!canRoll} style={rollButtonStyle(canRoll)}>
          {rolling ? 'Rodando...' : 'Tirar dados'}
        </button>
      </div>

      <button className="chunky-btn" onClick={() => setConfirmingExit(true)} title="Salir del juego" style={exitButtonStyle}>
        ✕
      </button>

      {confirmingExit && (
        <div style={overlayStyle}>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#f2ede0' }}>¿Seguro que querés salir?</div>
          <div style={{ ...hintTextStyle, marginBottom: 4 }}>Se perderá la partida en curso.</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="chunky-btn" onClick={() => setConfirmingExit(false)} style={secondaryButtonStyle}>
              Cancelar
            </button>
            <button className="chunky-btn" onClick={onExit} style={rollButtonStyle(true)}>
              Sí, salir
            </button>
          </div>
        </div>
      )}

      {winner && (
        <div style={overlayStyle}>
          <Confetti />
          <div
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 18,
              padding: '32px 44px',
              borderRadius: 24,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.06), transparent 25%), linear-gradient(165deg, rgba(58, 46, 30, 0.85), rgba(30, 23, 14, 0.85))',
              border: `3px solid ${getColor(winner.color)}`,
              boxShadow: `0 12px 34px rgba(0,0,0,0.55), 0 0 40px 4px ${getColor(winner.color)}55, inset 0 1px 0 rgba(255,255,255,0.12)`,
            }}
          >
            <div
              style={{
                color: getColor(winner.color),
                fontSize: 'clamp(26px, 7vw, 36px)',
                fontWeight: 800,
                textShadow: '0 2px 0 rgba(0,0,0,0.4), 0 0 22px currentColor',
                textAlign: 'center',
              }}
            >
              ¡{winner.color} gana!
            </div>
            <button className="chunky-btn" onClick={onExit} style={rollButtonStyle(true)}>
              Volver al inicio
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// A square board inside a landscape (or portrait) window always leaves margin beside it - no
// camera-fit math changes that geometry. That margin is now real 3D geometry (see
// scene/TableSurface.tsx - a large grass-toned plane under the board, extending well past the
// camera's own frustum) rather than empty CSS space, which is the actual fix for the flat-black-
// margins report; this background is just the (normally fully covered) fallback behind the
// Canvas, colored to the same grass tone so anything that peeks past the ground plane on an
// unusual aspect ratio still blends in instead of showing as a different color.
const screenWrapperStyle: React.CSSProperties = {
  height: '100%',
  position: 'relative',
  background: 'radial-gradient(ellipse at center, rgba(40, 84, 32, 0.4) 0%, rgba(10, 22, 8, 1) 75%)',
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

// Full pill shape (borderRadius 999), but now with the same solid (non-blurred) offset bottom
// edge as StartScreen/PlayerCountSelector's own chunky buttons - that crisp edge, not a bigger
// blurred shadow, is what actually reads as physical carved-wood depth. The two screens were
// restyled first and this one still used the earlier blurred-shadow pass, which read as a
// different, plainer button style right where the game's most-pressed button lives - reported
// directly as wanting one consistent button language across every screen, not per-screen styles.
function rollButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    padding: '12px 24px',
    fontSize: 16,
    fontWeight: 800,
    letterSpacing: 0.3,
    color: enabled ? '#eef4ff' : '#9a9a90',
    background: enabled
      ? 'linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0) 40%), linear-gradient(180deg, #dcebff 0%, #3d76e6 48%, #16409c 100%)'
      : 'linear-gradient(165deg, #6b6b62, #4a4a44)',
    border: `3px solid ${enabled ? '#1a3468' : '#3a3a34'}`,
    borderRadius: 999,
    boxShadow: enabled
      ? '0 5px 0 #1a3468, 0 9px 14px rgba(0,0,0,0.4), inset 0 2px 1px rgba(255,255,255,0.55)'
      : '0 5px 0 #3a3a34, inset 0 1px 2px rgba(0,0,0,0.3)',
    textShadow: enabled ? '0 1px 2px rgba(8,16,40,0.5)' : 'none',
    cursor: enabled ? 'pointer' : 'default',
  }
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '11px 22px',
  fontSize: 15,
  fontWeight: 700,
  color: '#f2ede0',
  background: 'linear-gradient(165deg, rgba(255,255,255,0.1), rgba(255,255,255,0) 60%), rgba(58, 46, 30, 0.6)',
  border: `3px solid ${BRAND_GOLD}`,
  borderRadius: 999,
  boxShadow: '0 5px 0 #1a3468, 0 8px 12px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.2)',
  cursor: 'pointer',
}

// Round medallion badge instead of a rectangular "Salir" pill - matches the fleur-de-lis/star
// corner ornaments already painted into the board art, and clears the boxy dead space a text
// button left in the corner (reported directly, alongside the panel/roll-button shapes). Same
// solid offset-edge depth as the pill buttons, just circular.
const exitButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 46,
  height: 46,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 17,
  fontWeight: 700,
  background:
    'linear-gradient(180deg, rgba(255,255,255,0.22), transparent 45%), linear-gradient(165deg, rgba(64, 50, 32, 0.95), rgba(36, 28, 18, 0.95))',
  border: `3px solid ${BRAND_GOLD}`,
  borderRadius: '50%',
  boxShadow: '0 5px 0 #1a3468, 0 9px 14px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)',
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
