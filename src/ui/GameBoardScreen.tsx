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

  // What the turn banner's subtitle says - one place for this instead of scattering the same
  // priority order (doubles warning > reward > move prompt > roll prompt) across JSX conditionals.
  const statusLine = eliminatedByDoubles
    ? `Tercer dobles seguido: ${eliminatedByDoubles.color} pierde una ficha`
    : pendingReward
      ? 'Elegí una ficha para tu recompensa'
      : pendingMoves.length > 0
        ? 'Elegí una ficha para mover'
        : lastRoll && !rolling
          ? `Dados: ${lastRoll.dieA} y ${lastRoll.dieB}${isDouble ? ' (dobles)' : ''} · Parkiller: ${lastRoll.blackDie}`
          : 'Tirá los dados para empezar tu turno'

  // Reported directly, with a full mockup: player info belongs at the table's own edges (like
  // players actually sitting around it), not bunched into one corner panel. Split left/right by
  // turn order so it scales to however many are actually seated (2-6), not just a fixed 4.
  const leftPlayers = session.players.filter((_, i) => i % 2 === 0)
  const rightPlayers = session.players.filter((_, i) => i % 2 === 1)

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

      <div style={turnBannerStyle}>
        <span style={{ ...turnDotStyle, width: 16, height: 16, background: getColor(currentPlayer.color) }} />
        <span style={{ fontWeight: 800, fontSize: 'clamp(15px, 3.4vw, 19px)', letterSpacing: 0.4 }}>
          TURNO DE {currentPlayer.color.toUpperCase()}
        </span>
        <span style={{ ...hintTextStyle, textAlign: 'center' }}>{statusLine}</span>
      </div>

      <div style={{ ...playerColumnStyle, left: 16 }}>
        {leftPlayers.map((p) => (
          <PlayerPanel key={p.color} player={p} isCurrentTurn={p.color === currentPlayer.color} />
        ))}
      </div>
      <div style={{ ...playerColumnStyle, right: 16 }}>
        {rightPlayers.map((p) => (
          <PlayerPanel key={p.color} player={p} isCurrentTurn={p.color === currentPlayer.color} />
        ))}
      </div>

      <button
        className="chunky-btn"
        onClick={() => canRoll && rollDice()}
        disabled={!canRoll}
        style={{ ...rollButtonStyle(canRoll), ...bottomRollButtonStyle }}
      >
        {rolling ? 'Rodando...' : 'Tirar dados'}
      </button>

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

// One panel per seated player, positioned at the table's own left/right edges (see leftPlayers/
// rightPlayers above) instead of bunched into a single corner - echoes players actually sitting
// around a physical board, per the reference mockup. Pieces-at-home count uses data already on
// PlayerState (Piece.state === 'Finished'), no new game-state tracking needed.
function PlayerPanel({ player, isCurrentTurn }: { player: PlayerState; isCurrentTurn: boolean }) {
  const home = player.pieces.filter((p) => p.state === 'Finished').length
  const color = getColor(player.color)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'clamp(6px, 2vw, 10px)',
        padding: 'clamp(5px, 1.5vw, 8px) clamp(8px, 3vw, 14px)',
        borderRadius: 14,
        background: isCurrentTurn
          ? 'linear-gradient(180deg, rgba(255,255,255,0.1), transparent 30%), linear-gradient(165deg, rgba(74, 120, 216, 0.35), rgba(36, 28, 18, 0.85))'
          : 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent 30%), linear-gradient(165deg, rgba(64, 50, 32, 0.85), rgba(30, 23, 14, 0.85))',
        border: `2px solid ${isCurrentTurn ? color : 'rgba(74,120,216,0.35)'}`,
        boxShadow: isCurrentTurn ? `0 0 14px 1px ${color}66, 0 4px 12px rgba(0,0,0,0.35)` : '0 4px 12px rgba(0,0,0,0.3)',
        minWidth: 'clamp(76px, 20vw, 108px)',
      }}
    >
      <span style={{ ...turnDotStyle, width: 'clamp(9px, 2.4vw, 12px)', height: 'clamp(9px, 2.4vw, 12px)', background: color, flexShrink: 0 }} />
      <div style={{ lineHeight: 1.3 }}>
        <div style={{ fontWeight: 800, fontSize: 'clamp(10px, 2.6vw, 12px)', letterSpacing: 0.3 }}>{player.color.toUpperCase()}</div>
        <div style={{ fontSize: 'clamp(9px, 2.3vw, 11px)', color: '#d8d2c2' }}>
          {home}/{player.pieces.length} en casa
        </div>
      </div>
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

// Reported directly, with a full mockup this time (a reference photo of a real table + an
// annotated UI layout): turn/status belongs in one large, unmissable banner top-center - not a
// small corner panel easy to miss mid-game - with per-player info at the table's own edges and
// the roll button as its own big, centered, unmissable action, echoing a real group sitting
// around a physical board rather than a single UI card floating over it.
const turnBannerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  background:
    'linear-gradient(180deg, rgba(255,255,255,0.06), transparent 30%), linear-gradient(165deg, rgba(64, 50, 32, 0.92), rgba(36, 28, 18, 0.92))',
  border: `2px solid ${BRAND_GOLD}`,
  boxShadow: `0 6px 20px rgba(0,0,0,0.4), inset 0 0 0 3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)`,
  padding: '8px clamp(12px, 4vw, 28px)',
  borderRadius: 18,
  fontFamily: 'system-ui, sans-serif',
  color: '#f2ede0',
  // Has to clear the exit button (right: 16, width 46) on both sides while staying centered - a
  // flat vw-based cap alone overlapped it on narrow phones, reported directly with a screenshot.
  maxWidth: 'min(78vw, calc(100vw - 140px))',
  boxSizing: 'border-box',
}

const playerColumnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'clamp(76px, 12vh, 90px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(6px, 1.5vh, 10px)',
  fontFamily: 'system-ui, sans-serif',
  color: '#f2ede0',
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

const bottomRollButtonStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 20,
  left: '50%',
  transform: 'translateX(-50%)',
  fontSize: 'clamp(16px, 4vw, 19px)',
  padding: '14px 40px',
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
