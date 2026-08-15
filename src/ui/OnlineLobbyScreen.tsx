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

// Milestone 2, in progress - reachable only via the hidden #online hash (see App.tsx), not linked
// from anywhere in the visible UI. Not yet exercised against a real Photon connection (no App ID
// was available while building this) - the logic is correct per the verified SDK/bridge behavior,
// but a live two-tab test is still a required follow-up once VITE_PHOTON_APP_ID is set.

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
      <h1 style={{ margin: 0 }}>Parkiller - Online (dev)</h1>

      {phase === 'connecting' && <p>Conectando a Photon...</p>}

      {phase === 'error' && (
        <div>
          <p style={{ color: '#e8a15c' }}>{errorMessage}</p>
        </div>
      )}

      {phase === 'menu' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: 320 }}>
          <div>
            <h3>Crear sala</h3>
            <label>
              Jugadores:{' '}
              <select value={playerCount} onChange={(e) => setPlayerCount(Number(e.target.value))}>
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={createRoom} style={buttonStyle}>
              Crear
            </button>
          </div>
          <div>
            <h3>Unirse a sala</h3>
            <input
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value)}
              placeholder="Código de sala"
              style={{ padding: 8, fontSize: 16, textTransform: 'uppercase' }}
            />
            <button onClick={joinRoom} style={buttonStyle}>
              Unirse
            </button>
          </div>
        </div>
      )}

      {(phase === 'creating' || phase === 'joining') && <p>...</p>}

      {phase === 'lobby' && connectionRef.current && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p>
            Código de sala: <strong>{roomCode}</strong>
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {TURN_ORDER_BY_COUNT[playerCount].map((color) => {
              const occupant = seats.find((a) => a.customProperties.color === color)
              return (
                <div key={color} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: getColor(color) }} />
                  <span>{color}</span>
                  <span style={{ color: '#999' }}>{occupant ? (occupant.isLocal ? '(vos)' : 'jugador conectado') : 'vacío -> bot'}</span>
                </div>
              )
            })}
          </div>
          {connectionRef.current.isMasterClient() ? (
            <button onClick={startGame} style={buttonStyle}>
              Empezar partida
            </button>
          ) : (
            <p>Esperando a que el anfitrión empiece la partida...</p>
          )}
        </div>
      )}
    </div>
  )
}

const wrapperStyle: React.CSSProperties = {
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 24,
  color: '#f2ede0',
  background: '#1a1310',
  fontFamily: 'system-ui, sans-serif',
}

const buttonStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 8,
  padding: '10px 18px',
  fontSize: 15,
  fontWeight: 600,
  background: '#ccb154',
  color: '#2a2a2a',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
}
