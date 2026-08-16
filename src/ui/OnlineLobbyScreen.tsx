import { useEffect, useRef, useState } from 'react'
import { toBoardData } from '../core/board/boardDefinition'
import { createPlayerState } from '../core/gameFlow/playerState'
import { TurnManager } from '../core/gameFlow/turnManager'
import { getColor } from '../core/colorPalette'
import type { PieceColor } from '../core/pieceColor'
import { TURN_ORDER_BY_COUNT } from '../core/turnOrder'
import { defaultRuleSettings } from '../core/rules/ruleSettings'
import { BOARD_DEFINITIONS } from '../data/boards'
import { BotController } from '../online/BotController'
import { QueueDice, RecordingDice } from '../online/dice'
import { HostTurnManagerBridge } from '../online/HostTurnManagerBridge'
import { PhotonConnection, type ActorInfo } from '../online/photonClient'
import type { GameMessage } from '../online/protocol'
import { RemoteTurnManager } from '../online/RemoteTurnManager'
import { GameBoardScreen, type GameSession } from './GameBoardScreen'

// Milestone 2 - reachable via the #online hash (see App.tsx), linked from StartScreen's "Jugar
// online" button once VITE_PHOTON_APP_ID is configured (see StartScreen.tsx's canPlayOnline gate).
// Verified against a real Photon App ID with two independent browser clients: room creation,
// joining, seat assignment, bot fill-in for empty seats, the game-start broadcast, and a live dice
// roll all relayed correctly and produced identical state on both sides.
//
// Reported directly, with a screenshot: this screen still looked like an unstyled dev tool (plain
// dark background, default HTML <select>/<input>, flat buttons) right next to a start screen and
// in-game HUD that had both since been restyled - same carved-wood card/button language ported
// here so the flow doesn't visibly change games partway through.

const REGION = 'us' // TODO: region picker, or Photon's own Best Region flow - fixed for Phase 1
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I - easier to read aloud/type

function generateRoomCode(): string {
  let code = ''
  for (let i = 0; i < 5; i++) code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]
  return code
}

type Phase = 'connecting' | 'error' | 'menu' | 'creating' | 'joining' | 'lobby' | 'game'

export default function OnlineLobbyScreen() {
  const [phase, setPhase] = useState<Phase>('connecting')
  const [errorMessage, setErrorMessage] = useState('')
  const [roomCodeInput, setRoomCodeInput] = useState('')
  const [playerCount, setPlayerCount] = useState(4)
  const [roomCode, setRoomCode] = useState('')
  const [seats, setSeats] = useState<ActorInfo[]>([])
  const [session, setSession] = useState<GameSession | null>(null)
  const connectionRef = useRef<PhotonConnection | null>(null)
  // Stored so the cleanup below can dispose it - startGame() constructs this imperatively (only
  // when bot seats exist), not from its own effect, so nothing else was holding a reference to
  // stop its turnStarted/moveChoicesReady subscriptions and pending setTimeouts on unmount.
  const botControllerRef = useRef<BotController | null>(null)

  useEffect(() => {
    const appId = import.meta.env.VITE_PHOTON_APP_ID
    if (!appId) {
      setErrorMessage('Falta VITE_PHOTON_APP_ID - agregalo a .env.local (ver .env.example)')
      setPhase('error')
      return
    }
    const connection = new PhotonConnection(appId)
    connectionRef.current = connection
    connection
      .connect(REGION)
      .then(() => setPhase('menu'))
      .catch((err: unknown) => {
        setErrorMessage(`No se pudo conectar: ${err instanceof Error ? err.message : String(err)}`)
        setPhase('error')
      })
    return () => {
      botControllerRef.current?.dispose()
      connection.disconnect()
    }
  }, [])

  useEffect(() => {
    const connection = connectionRef.current
    if (!connection || phase !== 'lobby') return
    const updateSeats = () => setSeats(connection.getActors())
    updateSeats()
    return connection.onActorsChanged(updateSeats)
  }, [phase])

  // Non-master clients: the Master broadcasts gameStarted once it clicks "Empezar partida" - this
  // is how everyone else in the lobby transitions into the game at the same moment.
  //
  // A live broadcast alone misses anyone whose subscription wasn't registered yet at the instant
  // it was sent - e.g. the Master clicking "Empezar partida" in the gap between a joiner's
  // joinRoom() promise resolving and this effect actually running after that render. Photon doesn't
  // cache/replay events by default, so that client would wait on the lobby screen forever for a
  // signal that already fired. startGame() also mirrors the same data into room properties (which
  // Photon *does* sync to every actor, including ones who join/re-render later), so this checks
  // those directly first, before subscribing to catch anyone who starts after this point.
  useEffect(() => {
    const connection = connectionRef.current
    if (!connection || phase !== 'lobby' || connection.isMasterClient()) return
    const props = connection.getRoomProperties()
    if (props.started) {
      startAsRemote(connection, props.startedColors as PieceColor[])
      return
    }
    return connection.onMessage((data) => {
      const msg = data as GameMessage
      if (msg.type !== 'gameStarted') return
      startAsRemote(connection, msg.colors)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  function startAsRemote(connection: PhotonConnection, colors: PieceColor[]) {
    const board = toBoardData(BOARD_DEFINITIONS[colors.length])
    const players = colors.map((color) => createPlayerState(color, board))
    const diceQueue = new QueueDice()
    const inner = new TurnManager(board, players, defaultRuleSettings(), diceQueue)
    const bridge = new RemoteTurnManager(inner, diceQueue, players, connection)
    bridge.start()
    setSession({ turnManager: bridge, players })
    setPhase('game')
  }

  function createRoom() {
    const connection = connectionRef.current
    if (!connection) return
    const code = generateRoomCode()
    setPhase('creating')
    connection
      .createRoom(code, playerCount)
      .then(() => {
        connection.setRoomProperties({ playerCount })
        connection.setLocalActorProperties({ color: TURN_ORDER_BY_COUNT[playerCount][0] })
        setRoomCode(code)
        setPhase('lobby')
      })
      .catch((err: unknown) => {
        setErrorMessage(`No se pudo crear la sala: ${err instanceof Error ? err.message : String(err)}`)
        setPhase('error')
      })
  }

  function joinRoom() {
    const connection = connectionRef.current
    const code = roomCodeInput.trim().toUpperCase()
    if (!connection || !code) return
    setPhase('joining')
    connection
      .joinRoom(code)
      .then(() => {
        const count = (connection.getRoomProperties().playerCount as number | undefined) ?? 4
        const colors = TURN_ORDER_BY_COUNT[count]
        const taken = new Set(connection.getActors().map((a) => a.customProperties.color as PieceColor | undefined))
        const myColor = colors.find((c) => !taken.has(c)) ?? colors[colors.length - 1]
        connection.setLocalActorProperties({ color: myColor })
        setRoomCode(code)
        setPlayerCount(count)
        setPhase('lobby')
      })
      .catch((err: unknown) => {
        setErrorMessage(`No se pudo unir a la sala: ${err instanceof Error ? err.message : String(err)}`)
        setPhase('error')
      })
  }

  function startGame() {
    const connection = connectionRef.current
    if (!connection) return
    const colors = TURN_ORDER_BY_COUNT[playerCount]
    const board = toBoardData(BOARD_DEFINITIONS[playerCount])
    const players = colors.map((color) => createPlayerState(color, board))
    const dice = new RecordingDice()
    const inner = new TurnManager(board, players, defaultRuleSettings(), dice)

    const actorColors = new Map<number, PieceColor>()
    for (const actor of connection.getActors()) {
      const color = actor.customProperties.color as PieceColor | undefined
      if (color) actorColors.set(actor.actorNr, color)
    }
    const bridge = new HostTurnManagerBridge(inner, dice, players, connection, actorColors)

    // Any color nobody claimed a seat for becomes a bot - this is what "bots fill empty seats" means.
    const claimedColors = new Set(actorColors.values())
    const botColors = new Set(colors.filter((c) => !claimedColors.has(c)))
    if (botColors.size > 0) botControllerRef.current = new BotController(bridge, botColors)

    bridge.start()
    // Mirrored into room properties (not just the broadcast below) so a client that joins or
    // re-renders after this point still sees the game already started - see the lobby-phase
    // effect above for why the broadcast alone isn't enough.
    connection.setRoomProperties({ started: true, startedColors: colors })
    connection.broadcast({ type: 'gameStarted', colors, seats: Object.fromEntries(actorColors) })
    setSession({ turnManager: bridge, players })
    setPhase('game')
  }

  if (phase === 'game' && session) {
    return <GameBoardScreen definition={BOARD_DEFINITIONS[playerCount]} session={session} onExit={() => (window.location.hash = '')} />
  }

  return (
    <div style={wrapperStyle}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
          <img src="/logo-badge.png" alt="Parkiller" style={{ width: 56, height: 56, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))' }} />
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: '#dce8ff', textShadow: '0 2px 0 #1a3468, 0 4px 10px rgba(0,0,0,0.5)' }}>
            Jugar online
          </h1>
        </div>

        {phase === 'connecting' && <p style={hintStyle}>Conectando a Photon...</p>}

        {phase === 'error' && <p style={{ ...hintStyle, color: '#e8a15c' }}>{errorMessage}</p>}

        {phase === 'menu' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: 340 }}>
            <div style={sectionStyle}>
              <h3 style={sectionTitleStyle}>Crear sala</h3>
              <div style={{ marginBottom: 14 }}>
                <div style={{ ...hintStyle, marginBottom: 8 }}>Jugadores</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[2, 3, 4, 5, 6].map((n) => (
                    <button key={n} className="chunky-btn" onClick={() => setPlayerCount(n)} style={countButtonStyle(n === playerCount)}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <button className="chunky-btn" onClick={createRoom} style={chunkyButtonStyle(true)}>
                Crear
              </button>
            </div>

            <div style={sectionStyle}>
              <h3 style={sectionTitleStyle}>Unirse a sala</h3>
              <input
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value)}
                placeholder="CÓDIGO DE SALA"
                style={inputStyle}
              />
              <div style={{ height: 12 }} />
              <button
                className="chunky-btn"
                onClick={joinRoom}
                disabled={!roomCodeInput.trim()}
                style={chunkyButtonStyle(Boolean(roomCodeInput.trim()))}
              >
                Unirse
              </button>
            </div>
          </div>
        )}

        {(phase === 'creating' || phase === 'joining') && <p style={hintStyle}>...</p>}

        {phase === 'lobby' && connectionRef.current && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 340 }}>
            <div style={sectionStyle}>
              <div style={hintStyle}>Código de sala</div>
              <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 3, color: '#dce8ff', textShadow: '0 2px 0 #1a3468' }}>{roomCode}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {TURN_ORDER_BY_COUNT[playerCount].map((color) => {
                const occupant = seats.find((a) => a.customProperties.color === color)
                return (
                  <div key={color} style={seatRowStyle}>
                    <span style={{ ...seatDotStyle, background: getColor(color) }} />
                    <span style={{ fontWeight: 700, flex: 1 }}>{color}</span>
                    <span style={{ color: occupant ? '#bfe8bf' : '#a89a80', fontSize: 13 }}>
                      {occupant ? (occupant.isLocal ? '(vos)' : 'jugador conectado') : 'vacío -> bot'}
                    </span>
                  </div>
                )
              })}
            </div>
            {connectionRef.current.isMasterClient() ? (
              <button className="chunky-btn" onClick={startGame} style={chunkyButtonStyle(true)}>
                Empezar partida
              </button>
            ) : (
              <p style={hintStyle}>Esperando a que el anfitrión empiece la partida...</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const wrapperStyle: React.CSSProperties = {
  height: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#f2ede0',
  fontFamily: 'system-ui, sans-serif',
  backgroundImage: 'radial-gradient(ellipse at center, rgba(10,8,4,0.35) 0%, rgba(8,6,3,0.82) 100%), url(/boards/board_4p.jpg)',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
}

// Same carved-wood card as StartScreen's own title/button panel - reused as a plain style object
// (not a shared component) since each screen's internal layout differs enough that a shared
// wrapper component would need as many override props as it saves.
const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '36px 44px',
  borderRadius: 28,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent 25%), linear-gradient(165deg, rgba(58, 46, 30, 0.85), rgba(30, 23, 14, 0.85))',
  border: '2px solid #1a3468',
  boxShadow: '0 10px 30px rgba(0,0,0,0.5), inset 0 0 0 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
}

const sectionStyle: React.CSSProperties = {
  padding: '16px 18px',
  borderRadius: 14,
  background: 'rgba(0,0,0,0.2)',
  border: '1px solid rgba(74,120,216,0.4)',
}

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 12px 0',
  fontSize: 16,
  fontWeight: 700,
  color: '#dce8ff',
}

const hintStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#d8d2c2',
}

const seatRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  borderRadius: 10,
  background: 'rgba(0,0,0,0.2)',
  border: '1px solid rgba(74,120,216,0.25)',
}

const seatDotStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: '50%',
  boxShadow: '0 0 6px rgba(0,0,0,0.5)',
  flexShrink: 0,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 14px',
  fontSize: 16,
  fontWeight: 700,
  letterSpacing: 2,
  textTransform: 'uppercase',
  color: '#dce8ff',
  background: 'rgba(0,0,0,0.35)',
  border: '2px solid #1a3468',
  borderRadius: 10,
  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.4)',
}

// Same chunky carved-wood recipe used across StartScreen/PlayerCountSelector/GameBoardScreen: a
// solid (non-blurred) offset bottom edge reads as physical depth, not just a bigger shadow.
function chunkyButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '14px 24px',
    fontSize: 17,
    fontWeight: 800,
    letterSpacing: 0.3,
    color: enabled ? '#eef4ff' : '#8a8a80',
    background: enabled
      ? 'linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0) 40%), linear-gradient(180deg, #c8dcff 0%, #4a78d8 55%, #2850a8 100%)'
      : 'linear-gradient(180deg, #8a8a80, #6a6a60)',
    border: `3px solid ${enabled ? '#1a3468' : '#4a4a44'}`,
    borderRadius: 16,
    boxShadow: enabled
      ? '0 5px 0 #1a3468, 0 9px 16px rgba(0,0,0,0.4), inset 0 2px 1px rgba(255,255,255,0.55)'
      : '0 5px 0 #3a3a34, 0 8px 12px rgba(0,0,0,0.3)',
    textShadow: enabled ? '0 1px 2px rgba(8,16,40,0.5)' : 'none',
    cursor: enabled ? 'pointer' : 'default',
  }
}

function countButtonStyle(selected: boolean): React.CSSProperties {
  return {
    width: 44,
    height: 44,
    fontSize: 17,
    fontWeight: 800,
    color: selected ? '#eef4ff' : '#c8d4ec',
    background: selected
      ? 'linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0) 40%), linear-gradient(180deg, #d4e4ff 0%, #6a94e8 55%, #3868c0 100%)'
      : 'linear-gradient(180deg, rgba(255,255,255,0.25), rgba(255,255,255,0) 40%), linear-gradient(180deg, #4a6aa0 0%, #345078 55%, #223a5a 100%)',
    border: `2px solid ${selected ? '#3868c0' : '#1a3468'}`,
    borderRadius: 12,
    boxShadow: selected
      ? '0 3px 0 #24448c, 0 6px 10px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.6)'
      : '0 3px 0 #14253f, 0 5px 8px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.25)',
    cursor: 'pointer',
  }
}
