import { useEffect, useState } from 'react'
import type { BoardDefinition } from '../core/board/boardDefinition'
import type { PlayerState } from '../core/gameFlow/playerState'
import { getColor } from '../core/colorPalette'
import type { TurnManagerLike } from '../core/gameFlow/turnManagerLike'
import { useTurnManager } from '../hooks/useTurnManager'
import { BoardScene } from '../scene/BoardScene'
import { Confetti } from './Confetti'
import { RewardToast } from './RewardToast'
import { GoldPanel } from './GoldPanel'
import { THEME } from './theme'

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

  // Player info belongs at the table's own edges (like players actually sitting around it), split
  // left/right by turn order so it scales to however many are actually seated (2-6).
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

      <div style={frameOverlayStyle} />

      <RewardToast pendingReward={pendingReward} forfeitedReward={forfeitedReward} />

      <GoldPanel accent={getColor(currentPlayer.color)} style={turnBannerStyle}>
        <span style={{ ...turnDotStyle, background: getColor(currentPlayer.color) }} />
        <span style={{ fontWeight: 800, fontSize: 'clamp(15px, 3.4vw, 19px)', letterSpacing: 0.6 }}>
          TURNO DE {currentPlayer.color.toUpperCase()}
        </span>
        <span style={{ fontSize: 13, color: THEME.creamDim, textAlign: 'center' }}>{statusLine}</span>
      </GoldPanel>

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
        {rolling ? 'RODANDO...' : 'TIRAR DADOS'}
      </button>

      <button className="chunky-btn" onClick={() => setConfirmingExit(true)} title="Salir del juego" style={exitButtonStyle}>
        ✕
      </button>

      {confirmingExit && (
        <div style={overlayStyle}>
          <GoldPanel style={dialogStyle}>
            <div style={{ fontSize: 18, fontWeight: 700, color: THEME.cream }}>¿Seguro que querés salir?</div>
            <div style={{ fontSize: 13, color: THEME.creamDim, marginBottom: 4 }}>Se perderá la partida en curso.</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="chunky-btn" onClick={() => setConfirmingExit(false)} style={secondaryButtonStyle}>
                Cancelar
              </button>
              <button className="chunky-btn" onClick={onExit} style={rollButtonStyle(true)}>
                Sí, salir
              </button>
            </div>
          </GoldPanel>
        </div>
      )}

      {winner && (
        <div style={overlayStyle}>
          <Confetti />
          <GoldPanel
            accent={getColor(winner.color)}
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 18,
              padding: '32px 44px',
              borderRadius: 24,
              boxShadow: `0 12px 34px rgba(0,0,0,0.55), 0 0 40px 4px ${getColor(winner.color)}55, inset 0 1px 0 rgba(255,255,255,0.1)`,
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
          </GoldPanel>
        </div>
      )}
    </div>
  )
}

// One panel per seated player, at the table's own left/right edges (see leftPlayers/rightPlayers
// above) - echoes players actually sitting around a physical board. Shows only the two counts
// that actually matter mid-game (in play vs. safely home), not every piece's exact square. The
// current player's panel is emphasized (brighter border/glow, bolder text); everyone else is
// shown weaker, per the brief's own "current player stronger, others weaker" note.
function PlayerPanel({ player, isCurrentTurn }: { player: PlayerState; isCurrentTurn: boolean }) {
  const inPlay = player.pieces.filter((p) => p.state === 'OnTrack' || p.state === 'InHomeCorridor').length
  const atHome = player.pieces.filter((p) => p.state === 'Finished').length
  const color = getColor(player.color)
  return (
    <GoldPanel
      ticks={false}
      accent={isCurrentTurn ? color : 'rgba(201,162,75,0.32)'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'clamp(6px, 2vw, 10px)',
        padding: 'clamp(5px, 1.5vw, 8px) clamp(8px, 3vw, 14px)',
        borderRadius: 12,
        opacity: isCurrentTurn ? 1 : 0.6,
        boxShadow: isCurrentTurn
          ? `0 0 14px 1px ${color}55, 0 4px 12px rgba(0,0,0,0.4)`
          : '0 4px 10px rgba(0,0,0,0.3)',
        minWidth: 'clamp(84px, 21vw, 118px)',
      }}
    >
      <span style={{ ...turnDotStyle, width: 'clamp(9px, 2.4vw, 12px)', height: 'clamp(9px, 2.4vw, 12px)', background: color, flexShrink: 0 }} />
      <div style={{ lineHeight: 1.35 }}>
        <div style={{ fontWeight: 800, fontSize: 'clamp(10px, 2.6vw, 12px)', letterSpacing: 0.3 }}>{player.color.toUpperCase()}</div>
        <div style={{ fontSize: 'clamp(9px, 2.2vw, 10.5px)', color: THEME.creamDim }}>En juego: {inPlay}</div>
        <div style={{ fontSize: 'clamp(9px, 2.2vw, 10.5px)', color: THEME.creamDim }}>En casa: {atHome}</div>
      </div>
    </GoldPanel>
  )
}

// A square board inside a landscape (or portrait) window always leaves margin beside it - that
// margin is now real 3D geometry (see scene/TableSurface.tsx, a dark wood table under the board)
// rather than empty CSS space; this background is the (normally fully covered) fallback behind
// the Canvas. Deep near-black green, matching the "dark wood / deep green / gold" palette
// requested directly - the 3D scene's own spotlight (see BoardScene) does the actual board-
// focused lighting; this is just what shows if the ground plane doesn't fully cover an unusual
// aspect ratio.
const screenWrapperStyle: React.CSSProperties = {
  height: '100%',
  position: 'relative',
  background: `radial-gradient(ellipse at center, ${THEME.wood}66 0%, ${THEME.woodDeep} 78%)`,
}

// A thin gold inset line plus a soft dark vignette at the very edges, echoing the requested
// lighting hierarchy (board brightest, edges dimmer) without a heavy post-process effect.
// Pointer-events none so it never intercepts clicks meant for the HUD or the 3D scene beneath it.
const frameOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  boxShadow: `inset 0 0 0 3px ${THEME.gold}45, inset 0 0 100px 34px rgba(0,0,0,0.55)`,
}

const turnBannerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: '8px clamp(12px, 4vw, 28px)',
  borderRadius: 16,
  // Has to clear the exit button (right: 16, width 46) on both sides while staying centered.
  maxWidth: 'min(78vw, calc(100vw - 140px))',
}

const playerColumnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'clamp(76px, 12vh, 90px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(6px, 1.5vh, 10px)',
}

const turnDotStyle: React.CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: '50%',
  boxShadow: '0 0 6px rgba(0,0,0,0.5)',
  flexShrink: 0,
}

const bottomRollButtonStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 20,
  left: '50%',
  transform: 'translateX(-50%)',
  fontSize: 'clamp(15px, 4vw, 19px)',
  padding: '14px clamp(24px, 8vw, 40px)',
  whiteSpace: 'nowrap',
}

// Deep green + gold border + a soft gold glow, matching the "premium board game" palette instead
// of the earlier plain blue pill - this is the single most important action in the game, so it
// keeps the same physical carved-edge depth language as every other chunky-btn but in its own
// distinct color, not shared with any secondary action.
function rollButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    padding: '12px 24px',
    fontSize: 16,
    fontWeight: 800,
    letterSpacing: 0.4,
    color: enabled ? THEME.cream : '#9a9a90',
    background: enabled
      ? `linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 40%), linear-gradient(180deg, ${THEME.greenLight} 0%, ${THEME.green} 55%, ${THEME.greenDeep} 100%)`
      : 'linear-gradient(165deg, #6b6b62, #4a4a44)',
    border: `3px solid ${enabled ? THEME.gold : '#3a3a34'}`,
    borderRadius: 999,
    boxShadow: enabled
      ? `0 5px 0 ${THEME.goldDeep}, 0 0 20px 2px rgba(201,162,75,0.35), 0 9px 14px rgba(0,0,0,0.4), inset 0 2px 1px rgba(255,255,255,0.3)`
      : '0 5px 0 #3a3a34, inset 0 1px 2px rgba(0,0,0,0.3)',
    textShadow: enabled ? '0 1px 2px rgba(0,0,0,0.5)' : 'none',
    cursor: enabled ? 'pointer' : 'default',
  }
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '11px 22px',
  fontSize: 15,
  fontWeight: 700,
  color: THEME.cream,
  background: `linear-gradient(165deg, rgba(255,255,255,0.08), rgba(255,255,255,0) 60%), ${THEME.wood}99`,
  border: `3px solid ${THEME.gold}`,
  borderRadius: 999,
  boxShadow: `0 5px 0 ${THEME.goldDeep}, 0 8px 12px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.15)`,
  cursor: 'pointer',
}

// Round medallion badge instead of a rectangular "Salir" pill - kept as an explicit ✕ (not
// relabeled to a generic hamburger/menu icon) since there's no broader menu behind it yet, just
// this one exit action - relabeling it would promise options that don't exist. Same gold-ring
// styling as every other chunky-btn on this screen, just circular.
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
  background: `linear-gradient(180deg, rgba(255,255,255,0.14), transparent 45%), linear-gradient(165deg, ${THEME.green}f2, ${THEME.greenDeep}f7)`,
  border: `3px solid ${THEME.gold}`,
  borderRadius: '50%',
  boxShadow: `0 5px 0 ${THEME.goldDeep}, 0 9px 14px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.12)`,
  color: THEME.cream,
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
  background: 'rgba(0,0,0,0.6)',
}

const dialogStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: '24px 28px',
  borderRadius: 20,
}
