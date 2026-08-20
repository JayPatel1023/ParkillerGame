import { useEffect, useState } from 'react'
import type { BoardDefinition } from '../core/board/boardDefinition'
import type { PlayerState } from '../core/gameFlow/playerState'
import { getColor } from '../core/colorPalette'
import type { TurnManagerLike } from '../core/gameFlow/turnManagerLike'
import type { Piece } from '../core/pieces/piece'
import type { MoveOption } from '../core/rules/moveOption'
import { useTurnManager } from '../hooks/useTurnManager'
import { BoardScene } from '../scene/BoardScene'
import { Confetti } from './Confetti'
import { RewardToast } from './RewardToast'

// Reported directly, with a photoreal reference (ornate leather-and-gold game table, candlelit):
// match its background mood plus its buttons' style/shape/position. This trim color used to be
// the royal-blue accent picked for Start/Lobby - this screen now breaks from that to an actual
// warm gold matching the new reference, since Start/Lobby weren't part of this ask.
const BRAND_GOLD = '#c9a24b'

// Lightens (positive percent) or darkens (negative) a hex color - used to derive a per-player
// gradient/shadow/border from just that player's base swatch (core/colorPalette.ts), so the turn
// card's roll button reads in the current player's own color like the reference's red-bordered
// card on red's turn, without hand-authoring a gradient per color.
function shade(hex: string, percent: number): string {
  const num = parseInt(hex.slice(1), 16)
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + Math.round(255 * percent)))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + Math.round(255 * percent)))
  const b = Math.min(255, Math.max(0, (num & 0xff) + Math.round(255 * percent)))
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

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

  // Reported directly, from a real two-player online test: a player could click "roll" (or a
  // board piece) during someone else's turn - the Master correctly rejects the resulting network
  // intent, but the *clicking* player's own UI had no way to know that, and worse, a rejected roll
  // never fires the diceRolled event that clears useTurnManager's own `rolling` flag, so that
  // player's roll button got stuck disabled/spinning for the rest of the game. `localPlayerColor`
  // is undefined for local pass-and-play (one shared device controls every color, so there's
  // nothing to restrict) and set to this client's own seat color for online play - see
  // TurnManagerLike's own doc comment.
  const localColor = session.turnManager.localPlayerColor
  const isMyTurn = localColor == null || localColor === currentPlayer.color

  // Reported directly ("차례차례대로... 앞장지르는 일이없도록"): the next move's piece choices and any
  // reward it earned were exposed the instant the underlying events fired - the same synchronous
  // tick the capturing/finishing move's own hop animation started, not once it actually finished
  // arriving. TurnManager itself never waits on animation (game state always advances the instant a
  // move is submitted - only the visual playback takes time, same as the capture-visual gating
  // above), so this hook's raw pendingMoves/pendingReward/forfeitedReward already reflect the next
  // real choice well before the board has caught up - gating what's actually shown/interactive on
  // both animations having cleared keeps everything landing in the order it visually happened.
  const animationsSettled = !moveAnimation && !parkillerAnimation
  const canRoll = isMyTurn && pendingMoves.length === 0 && !winner && !rolling && animationsSettled

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

  // Only the current turn's own piece choices are ever meant to be actionable - every online
  // client replays the same broadcast dice roll locally (see MoveAnimationInfo's own comment), so
  // pendingMoves gets populated identically on every client regardless of whose turn it actually
  // is. Without this gate, a piece would glow as selectable (and be clickable) on a client whose
  // turn it isn't - the Master would reject the resulting move intent, but the clicking player's
  // own board never should have offered it in the first place.
  const visiblePendingMoves = isMyTurn && animationsSettled ? pendingMoves : []
  const visiblePendingReward = animationsSettled ? pendingReward : null
  const visibleForfeitedReward = animationsSettled ? forfeitedReward : null

  // Reported directly ("SE DEBE PODER ELEGIR CON CUAL DE LOS DOS DADOS SE MUEVE EL PEON QUE SE
  // DESEE"): a piece reachable by both dice (to two different squares) used to just move by
  // whichever die TurnManager happened to check first, with no way to pick the other - clicking a
  // piece now only moves it immediately when there's exactly one legal option; with two or more
  // (see turnManager.ts's own offerMoves, which keeps every distinct amount instead of collapsing
  // to one per piece), this holds the choice open until the player picks one.
  const [pieceChoice, setPieceChoice] = useState<{ piece: Piece; options: MoveOption[] } | null>(null)
  useEffect(() => {
    setPieceChoice(null)
  }, [pendingMoves])

  function handleSelectPiece(piece: Piece) {
    // Clicking the same piece a choice is already open for backs out of it - the only "cancel"
    // affordance for the floating markers (see BoardScene's own PieceChoiceMarkers), since there's
    // no dialog chrome here to put a Cancelar button on.
    if (pieceChoice?.piece === piece) {
      setPieceChoice(null)
      return
    }
    const options = visiblePendingMoves.filter((m) => m.piece === piece)
    if (options.length <= 1) {
      chooseMove(piece, options[0]?.amount)
      return
    }
    setPieceChoice({ piece, options })
  }

  function confirmPieceChoice(amount: number) {
    if (!pieceChoice) return
    chooseMove(pieceChoice.piece, amount)
    setPieceChoice(null)
  }

  // What the turn banner's subtitle says - one place for this instead of scattering the same
  // priority order (doubles warning > not-my-turn > reward > move prompt > roll prompt) across
  // JSX conditionals.
  const statusLine = eliminatedByDoubles
    ? `Tercer dobles seguido: ${eliminatedByDoubles.color} pierde una ficha`
    : !isMyTurn
      ? `Esperando el turno de ${currentPlayer.color}...`
      : pieceChoice
        ? 'Elegí con qué dado moverla'
        : visiblePendingReward
          ? 'Elegí una ficha para tu recompensa'
          : visiblePendingMoves.length > 0
            ? 'Elegí una ficha para mover'
            : lastRoll && !rolling
              ? `Dados: ${lastRoll.dieA} y ${lastRoll.dieB}${isDouble ? ' (dobles)' : ''} · Parkiller: ${lastRoll.blackDie}`
              : 'Tirá los dados para empezar tu turno'

  return (
    <div className="game-screen-in" style={screenWrapperStyle}>
      <BoardScene
        definition={definition}
        players={session.players}
        pendingMoves={visiblePendingMoves}
        onSelectPiece={handleSelectPiece}
        currentPlayerColor={currentPlayer.color}
        diceValues={diceValues}
        rolling={rolling}
        nudgeDice={nudgeDice}
        onRollDice={() => canRoll && rollDice()}
        moveAnimation={moveAnimation}
        onAnimationComplete={clearMoveAnimation}
        parkillerAnimation={parkillerAnimation}
        onParkillerAnimationComplete={clearParkillerAnimation}
        pieceChoice={pieceChoice ? { piece: pieceChoice.piece, amounts: pieceChoice.options.map((o) => o.amount) } : null}
        onChoosePieceAmount={confirmPieceChoice}
      />

      <div style={frameOverlayStyle} />

      <RewardToast pendingReward={visiblePendingReward} forfeitedReward={visibleForfeitedReward} />

      <div style={turnCardStyle}>
        <div style={turnCardHeaderStyle}>
          <span style={{ ...avatarStyle, background: getColor(currentPlayer.color) }}>♟</span>
          <div style={{ minWidth: 0 }}>
            <div style={turnTitleStyle}>TURNO DE {currentPlayer.color.toUpperCase()}</div>
            <div style={turnSubtitleStyle}>{statusLine}</div>
          </div>
        </div>
        <button
          className="chunky-btn"
          onClick={() => canRoll && rollDice()}
          disabled={!canRoll}
          style={cardRollButtonStyle(canRoll, getColor(currentPlayer.color))}
        >
          {rolling ? 'RODANDO...' : 'TIRAR DADOS'}
        </button>
      </div>

      <div style={playerRowStyle}>
        {session.players.map((p) => (
          <PlayerPill key={p.color} player={p} isCurrentTurn={p.color === currentPlayer.color} isLocal={p.color === localColor} />
        ))}
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

// One pill per seated player, in a single row along the table's bottom edge (wraps on narrow
// phones) - matches the reference's row of player badges rather than the earlier per-side
// columns. Pieces-at-home count uses data already on PlayerState (Piece.state === 'Finished'),
// no new game-state tracking needed.
// isLocal (online play only - session.turnManager.localPlayerColor, undefined for local
// pass-and-play) marks which pill is *this client's own* seat, distinct from isCurrentTurn (whose
// turn it is right now) - reported directly: once a game actually starts, nothing on screen said
// which color a given online player even was anymore (the lobby's own "(vos)" tag only exists
// before that point) - important with more than 2 real people in a room, where "wait for your own
// name to light up" isn't enough to know which color that even is in the first place.
function PlayerPill({ player, isCurrentTurn, isLocal }: { player: PlayerState; isCurrentTurn: boolean; isLocal: boolean }) {
  const home = player.pieces.filter((p) => p.state === 'Finished').length
  const color = getColor(player.color)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'clamp(5px, 1.5vw, 8px)',
        padding: 'clamp(6px, 1.8vw, 9px) clamp(10px, 2.6vw, 14px)',
        borderRadius: 999,
        background: isCurrentTurn
          ? `linear-gradient(180deg, rgba(255,255,255,0.12), transparent 30%), linear-gradient(165deg, ${color}55, rgba(24,14,9,0.92))`
          : 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent 30%), linear-gradient(165deg, rgba(48,30,20,0.9), rgba(20,12,8,0.92))',
        border: `2px solid ${isLocal ? '#f2d98c' : isCurrentTurn ? color : 'rgba(201,162,75,0.4)'}`,
        boxShadow: isLocal
          ? `0 0 0 2px #f2d98c99, 0 0 12px 1px ${color}66, 0 4px 10px rgba(0,0,0,0.4)`
          : isCurrentTurn
            ? `0 0 12px 1px ${color}66, 0 4px 10px rgba(0,0,0,0.4)`
            : '0 4px 10px rgba(0,0,0,0.35)',
        fontFamily: 'system-ui, sans-serif',
        color: '#f2ede0',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{ width: 'clamp(9px, 2.2vw, 11px)', height: 'clamp(9px, 2.2vw, 11px)', borderRadius: '50%', background: color, boxShadow: '0 0 5px rgba(0,0,0,0.5)', flexShrink: 0 }}
      />
      <span style={{ fontWeight: 800, fontSize: 'clamp(10px, 2.4vw, 12px)', letterSpacing: 0.3 }}>{player.color.toUpperCase()}</span>
      <span style={{ fontSize: 'clamp(10px, 2.4vw, 12px)', color: '#d8d2c2' }}>
        ♟ {home}/{player.pieces.length}
      </span>
      {isLocal && <span style={{ fontWeight: 800, fontSize: 'clamp(9px, 2.2vw, 11px)', color: '#f2d98c' }}>(vos)</span>}
    </div>
  )
}

// Reported directly, calling the procedural 3D wood table "한심하다" (pathetic): the game's own
// ground plane (scene/TableSurface.tsx) is gone entirely now - BoardScene's Canvas is transparent
// and this real photo (moon.png, supplied directly) is the page's own CSS background behind it
// instead, same approach as StartScreen's own background photo. `cover` so it always fills the
// screen (see StartScreen's own comment history on cover vs. contain trade-offs - same
// reasoning applies here).
const screenWrapperStyle: React.CSSProperties = {
  height: '100%',
  position: 'relative',
  backgroundColor: '#05070c',
  backgroundImage: 'url(/backgrounds/moon.png)',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
}

// A thin gold inset line plus a soft dark vignette at the very edges - stands in for the
// reference's ornate gold arch frame without needing bespoke corner art. Pointer-events none so
// it never intercepts clicks meant for the HUD or the 3D scene beneath it.
const frameOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  boxShadow: `inset 0 0 0 3px ${BRAND_GOLD}55, inset 0 0 90px 30px rgba(0,0,0,0.55)`,
}

// Reported directly, with a photoreal reference: turn info lives in one card top-left (avatar +
// title + status + the roll action all together), not spread across a separate banner and a
// floating button - echoes the reference's single "RED'S TURN / Roll the dice" card exactly.
const turnCardStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 'clamp(12px, 3vw, 18px)',
  borderRadius: 18,
  background:
    'linear-gradient(180deg, rgba(255,255,255,0.07), transparent 30%), linear-gradient(165deg, rgba(48, 30, 20, 0.94), rgba(22, 13, 9, 0.96))',
  border: `2px solid ${BRAND_GOLD}`,
  boxShadow: `0 8px 22px rgba(0,0,0,0.5), inset 0 0 0 3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)`,
  width: 'clamp(200px, 62vw, 300px)',
  boxSizing: 'border-box',
  fontFamily: 'system-ui, sans-serif',
  color: '#f2ede0',
}

const turnCardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
}

const avatarStyle: React.CSSProperties = {
  width: 'clamp(38px, 9vw, 48px)',
  height: 'clamp(38px, 9vw, 48px)',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 'clamp(18px, 4vw, 22px)',
  color: '#fff',
  border: '2px solid rgba(255,255,255,0.4)',
  boxShadow: '0 3px 8px rgba(0,0,0,0.4), inset 0 2px 3px rgba(255,255,255,0.3)',
  flexShrink: 0,
}

const turnTitleStyle: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 'clamp(14px, 3.6vw, 18px)',
  letterSpacing: 0.4,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const turnSubtitleStyle: React.CSSProperties = {
  fontSize: 'clamp(11px, 2.6vw, 13px)',
  color: '#d8d2c2',
  marginTop: 2,
}

// One row of player pills along the table's bottom edge (see PlayerPill below), matching the
// reference's row of player badges - wraps on narrow phones instead of overflowing.
const playerRowStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: 'clamp(6px, 1.8vw, 10px)',
  maxWidth: 'calc(100vw - 24px)',
  padding: '0 8px',
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

// Lives inside turnCardStyle - colored to the current player's own swatch (via shade()) rather
// than a fixed brand color, echoing the reference's red-themed button on red's turn.
function cardRollButtonStyle(enabled: boolean, colorHex: string): React.CSSProperties {
  const dark = shade(colorHex, -0.5)
  const light = shade(colorHex, 0.35)
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '12px 20px',
    fontSize: 'clamp(14px, 3.6vw, 17px)',
    fontWeight: 800,
    letterSpacing: 0.5,
    color: enabled ? '#fff6e8' : '#9a9a90',
    background: enabled
      ? `linear-gradient(180deg, rgba(255,255,255,0.45), rgba(255,255,255,0) 40%), linear-gradient(180deg, ${light} 0%, ${colorHex} 55%, ${dark} 100%)`
      : 'linear-gradient(165deg, #6b6b62, #4a4a44)',
    border: `3px solid ${enabled ? dark : '#3a3a34'}`,
    borderRadius: 12,
    boxShadow: enabled
      ? `0 5px 0 ${dark}, 0 9px 14px rgba(0,0,0,0.4), inset 0 2px 1px rgba(255,255,255,0.4)`
      : '0 5px 0 #3a3a34, inset 0 1px 2px rgba(0,0,0,0.3)',
    textShadow: enabled ? '0 1px 2px rgba(0,0,0,0.5)' : 'none',
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
