import { useEffect, useRef, useState } from 'react'
import { StartScreenBackground } from '../scene/StartScreenBackground'
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

// Photon Realtime's own standard region codes (https://doc.photonengine.com/realtime/current/reference/regions) -
// a fixed, curated list rather than the SDK's own "Best Region" ping-and-pick flow: that flow needs
// an extra connect-to-nameserver round trip and a several-second ping phase before the room UI can
// even appear, and this app's own two players are typically already in the same room together
// deciding a region between themselves (a room code has to be shared out of band anyway), so a
// direct pick is both simpler and faster than auto-detection would be here. 'us' stays the default
// (unchanged behavior for anyone who never opens the picker) - was the hardcoded-only choice before.
const REGION_OPTIONS: { code: string; label: string }[] = [
  { code: 'us', label: 'EE.UU. (Este)' },
  { code: 'usw', label: 'EE.UU. (Oeste)' },
  { code: 'sa', label: 'Sudamérica' },
  { code: 'eu', label: 'Europa' },
  { code: 'asia', label: 'Asia' },
  { code: 'jp', label: 'Japón' },
]
const REGION_STORAGE_KEY = 'parkiller-photon-region'
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I - easier to read aloud/type

function generateRoomCode(): string {
  let code = ''
  for (let i = 0; i < 5; i++) code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]
  return code
}

// Every seat's color is a pure function of actorNr rank - the lowest actorNr in the room (always
// the creator, Photon's own rule) gets colors[0], matching "the room creator goes first", and so
// on. actorNr is Photon's own intrinsic actor identifier, assigned synchronously as part of the
// join operation itself - every client's own view of `connection.getActors()` already has it
// reliably for every actor in the room, with no extra network round trip to wait on.
//
// Reported directly, twice now, from real multi-client tests: earlier versions instead had each
// client privately compute its own color and broadcast it via a `color` custom property, which
// every OTHER client (crucially including the host, right before clicking "Empezar partida") had
// to read back. That's a real network round trip with a real race window - a joiner clicking in
// fast, or the host clicking "start" fast enough after seeing a joiner appear in the seat list,
// could read that property before it arrived, leaving an actually-connected human's seat looking
// unclaimed and falling back to a bot. Computing every seat's color directly from the room's own
// actor list (already reliably synced) removes that round trip - and the race it enabled -
// entirely, rather than trying to narrow the timing window.
function colorsByActorNr(actorNrs: readonly number[], colors: readonly PieceColor[]): Map<number, PieceColor> {
  const sorted = [...actorNrs].sort((a, b) => a - b)
  const map = new Map<number, PieceColor>()
  sorted.forEach((actorNr, rank) => map.set(actorNr, colors[rank] ?? colors[colors.length - 1]))
  return map
}

type Phase = 'connecting' | 'error' | 'menu' | 'creating' | 'joining' | 'lobby' | 'game' | 'stopped'

export default function OnlineLobbyScreen() {
  const [phase, setPhase] = useState<Phase>('connecting')
  const [errorMessage, setErrorMessage] = useState('')
  // Persisted so a returning player doesn't have to re-pick every visit - read once at mount, not
  // re-read on every render, since nothing outside this component ever changes localStorage's copy.
  const [region, setRegion] = useState(() => {
    const saved = localStorage.getItem(REGION_STORAGE_KEY)
    return REGION_OPTIONS.some((r) => r.code === saved) ? saved! : 'us'
  })
  const [roomCodeInput, setRoomCodeInput] = useState('')
  const [playerCount, setPlayerCount] = useState(4)
  const [roomCode, setRoomCode] = useState('')
  const [seats, setSeats] = useState<ActorInfo[]>([])
  const [session, setSession] = useState<GameSession | null>(null)
  // Set only once the game actually starts - who left, so the "stopped" screen can say so.
  const [stopReason, setStopReason] = useState('')
  // Reported directly, via a screen recording of two real clients: the creator clicked "Empezar
  // partida" alone (fully clickable the instant the room exists - see startGame()'s own comment on
  // why solo-start is unrestricted) a few seconds before a friend finished typing in the room code,
  // and that friend's join was rejected outright ("room has already started" - closeRoom() below
  // means exactly that). Nothing was actually broken - solo-vs-bots play needs exactly this
  // unrestricted button - but there was also no warning that clicking it alone commits the room
  // and locks out anyone still on their way in, which is very easy to trigger by accident if a
  // second real player was in fact expected. Confirming only in that specific case (still alone,
  // i.e. the exact moment a friend joining a second later would get shut out) adds one extra click
  // for genuine solo-vs-bots play without touching the gate itself.
  const [confirmingSoloStart, setConfirmingSoloStart] = useState(false)
  const connectionRef = useRef<PhotonConnection | null>(null)
  // Stored so the cleanup below can dispose it - startGame() constructs this imperatively (only
  // when bot seats exist), not from its own effect, so nothing else was holding a reference to
  // stop its turnStarted/moveChoicesReady subscriptions and pending setTimeouts on unmount.
  const botControllerRef = useRef<BotController | null>(null)
  // Which actorNr controls which color, frozen at the moment the game actually started - the same
  // mapping every client independently freezes (see startGame()/startAsRemote() below), used only
  // to tell a real departing player's seat apart from a bot's the instant they leave (see the
  // actor-left effect below). A bot has no connected actor at all, so it can never appear here.
  const realSeatsRef = useRef<Record<number, PieceColor>>({})

  // Re-runs whenever `region` changes (see the picker in the 'menu' phase below) - tearing down
  // the old connection and opening a fresh one against the newly chosen region. Only reachable from
  // 'menu'/'error' in practice (the picker isn't rendered once a room exists), so this never fires
  // mid-lobby/mid-game.
  useEffect(() => {
    const appId = import.meta.env.VITE_PHOTON_APP_ID
    if (!appId) {
      setErrorMessage('Falta VITE_PHOTON_APP_ID - agregalo a .env.local (ver .env.example)')
      setPhase('error')
      return
    }
    setPhase('connecting')
    const connection = new PhotonConnection(appId)
    connectionRef.current = connection
    connection
      .connect(region)
      .then(() => setPhase('menu'))
      .catch((err: unknown) => {
        setErrorMessage(`No se pudo conectar: ${err instanceof Error ? err.message : String(err)}`)
        setPhase('error')
      })
    return () => {
      botControllerRef.current?.dispose()
      connection.disconnect()
    }
  }, [region])

  function changeRegion(code: string) {
    if (code === region) return
    localStorage.setItem(REGION_STORAGE_KEY, code)
    setRegion(code)
  }

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
      startAsRemote(connection, props.startedColors as PieceColor[], props.startedSeats as Record<number, PieceColor>)
      return
    }
    return connection.onMessage((data) => {
      const msg = data as GameMessage
      if (msg.type !== 'gameStarted') return
      startAsRemote(connection, msg.colors, msg.seats)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Reported directly: if a real player left an in-progress game, everyone else just kept playing
  // shorthanded instead of stopping - wanted to know who left and have the game end there for
  // everyone still connected. Photon's own actor-leave event already reaches every client in the
  // room independently (not just the Master), so each client detects this and stops itself locally
  // - no extra broadcast needed. realSeatsRef (frozen the instant the game actually started, by
  // both startGame() and startAsRemote() below) is what tells a real player's seat apart from a
  // bot's - a bot was never a connected actor, so it can never fire this at all.
  useEffect(() => {
    const connection = connectionRef.current
    if (!connection || phase !== 'game') return
    return connection.onActorLeft((actorNr) => {
      const color = realSeatsRef.current[actorNr]
      if (!color) return
      botControllerRef.current?.dispose()
      botControllerRef.current = null
      session?.turnManager.dispose?.()
      setSession(null)
      setStopReason(`${color} salió de la sala - la partida se detuvo.`)
      setPhase('stopped')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  function startAsRemote(connection: PhotonConnection, colors: PieceColor[], seats: Record<number, PieceColor>) {
    const board = toBoardData(BOARD_DEFINITIONS[colors.length])
    const players = colors.map((color) => createPlayerState(color, board))
    const diceQueue = new QueueDice()
    const inner = new TurnManager(board, players, defaultRuleSettings(), diceQueue)
    const myColor = colorsByActorNr(connection.getActors().map((a) => a.actorNr), colors).get(connection.localActorNr)
    const bridge = new RemoteTurnManager(inner, diceQueue, players, connection, myColor ?? null)
    bridge.start()
    realSeatsRef.current = seats ?? {}
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
        // maxPlayers is set atomically as part of room creation itself (see photonClient.ts's own
        // getMaxPlayers() comment) - nothing to race reading that.
        const count = connection.getMaxPlayers() || 4
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
    // Belt-and-suspenders alongside the disabled button below - once 2+ real people are present,
    // every real seat must be filled before a game can start (see the lobby's own banner for why);
    // alone, starting against bots is unrestricted.
    const actorCount = connection.getActors().length
    if (actorCount > 1 && actorCount < playerCount) return
    const colors = TURN_ORDER_BY_COUNT[playerCount]
    const board = toBoardData(BOARD_DEFINITIONS[playerCount])
    const players = colors.map((color) => createPlayerState(color, board))
    const dice = new RecordingDice()
    const inner = new TurnManager(board, players, defaultRuleSettings(), dice)

    const actorColors = colorsByActorNr(connection.getActors().map((a) => a.actorNr), colors)
    const myColor = actorColors.get(connection.localActorNr) ?? null
    const bridge = new HostTurnManagerBridge(inner, dice, players, connection, actorColors, myColor)

    // Any color nobody claimed a seat for becomes a bot - this is what "bots fill empty seats" means.
    const claimedColors = new Set(actorColors.values())
    const botColors = new Set(colors.filter((c) => !claimedColors.has(c)))
    if (botColors.size > 0) botControllerRef.current = new BotController(bridge, botColors)

    bridge.start()
    // Reported directly: a friend who joined the room code after this point still connected
    // successfully and ended up a non-functional phantom "player" instead of a clear error - see
    // closeRoom()'s own comment for the full mechanism. Nothing past this point should be reachable
    // by a new joiner at all.
    connection.closeRoom()
    realSeatsRef.current = Object.fromEntries(actorColors)
    // Mirrored into room properties (not just the broadcast below) so a client that joins or
    // re-renders after this point still sees the game already started - see the lobby-phase
    // effect above for why the broadcast alone isn't enough.
    connection.setRoomProperties({ started: true, startedColors: colors, startedSeats: realSeatsRef.current })
    connection.broadcast({ type: 'gameStarted', colors, seats: realSeatsRef.current })
    setSession({ turnManager: bridge, players })
    setPhase('game')
  }

  if (phase === 'game' && session) {
    return <GameBoardScreen definition={BOARD_DEFINITIONS[playerCount]} session={session} onExit={() => (window.location.hash = '')} />
  }

  return (
    <div style={wrapperStyle}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <StartScreenBackground />
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at center, rgba(10,8,4,0.15) 0%, rgba(6,8,14,0.7) 100%)',
        }}
      />
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
          <img
            src="/logo-badge.png"
            alt="Parkiller"
            style={{ width: 'clamp(42px, 12vw, 56px)', height: 'clamp(42px, 12vw, 56px)', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))', flexShrink: 0 }}
          />
          <h1 style={{ margin: 0, fontSize: 'clamp(21px, 6vw, 28px)', fontWeight: 800, color: '#dce8ff', textShadow: '0 2px 0 #1a3468, 0 4px 10px rgba(0,0,0,0.5)' }}>
            Jugar online
          </h1>
        </div>

        {/* Only shown before a room exists (menu/error/connecting) - once in a lobby, changing
            region out from under an already-open room/connection isn't a scenario worth supporting,
            so the picker simply isn't offered there. */}
        {(phase === 'menu' || phase === 'error' || phase === 'connecting') && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ ...hintStyle, marginBottom: 8 }}>Región</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {REGION_OPTIONS.map((r) => (
                <button
                  key={r.code}
                  className="chunky-btn"
                  onClick={() => changeRegion(r.code)}
                  disabled={phase === 'connecting'}
                  style={regionButtonStyle(r.code === region)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === 'connecting' && <p style={hintStyle}>Conectando a Photon...</p>}

        {phase === 'error' && <p style={{ ...hintStyle, color: '#e8a15c' }}>{errorMessage}</p>}

        {phase === 'stopped' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, width: '100%' }}>
            <p style={{ ...hintStyle, color: '#e8a15c', fontSize: 15 }}>{stopReason}</p>
            <button className="chunky-btn" onClick={() => setPhase('menu')} style={chunkyButtonStyle(true)}>
              Volver al menú
            </button>
          </div>
        )}

        {phase === 'menu' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: '100%' }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
            <div style={sectionStyle}>
              <div style={hintStyle}>Código de sala</div>
              <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 3, color: '#dce8ff', textShadow: '0 2px 0 #1a3468' }}>{roomCode}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(() => {
                const seatColors = colorsByActorNr(seats.map((a) => a.actorNr), TURN_ORDER_BY_COUNT[playerCount])
                return TURN_ORDER_BY_COUNT[playerCount].map((color) => {
                  const occupant = seats.find((a) => seatColors.get(a.actorNr) === color)
                  return (
                    <div key={color} style={seatRowStyle}>
                      <span style={{ ...seatDotStyle, background: getColor(color) }} />
                      <span style={{ fontWeight: 700, flex: 1 }}>{color}</span>
                      <span style={{ color: occupant ? '#bfe8bf' : '#a89a80', fontSize: 13 }}>
                        {occupant ? (occupant.isLocal ? '(vos)' : 'jugador conectado') : 'esperando jugador...'}
                      </span>
                    </div>
                  )
                })
              })()}
            </div>
            {/* Reported directly, every board size (2p-6p) the same way: starting once a SECOND
                real person had joined but before every seat was filled is exactly what let a bot
                silently take over a seat a friend was still in the middle of joining - the room-
                closing fix (see closeRoom()) stops a LATE join from becoming a phantom player, but
                starting early never needed a late join to go wrong in the first place. The creator
                playing solo against bots is a different, legitimate case though (reported directly
                right after shipping the first version of this gate, which blocked that too) - only
                2+ real people present requires every seat filled before "Empezar partida" is even
                clickable; alone, starting is unrestricted the same as it always was. Once full, a
                clear banner announces it's ready, matching "다들어왔다는 alert". */}
            {seats.length > 1 && seats.length < playerCount && (
              <p style={hintStyle}>Esperando a que se unan todos los jugadores ({seats.length}/{playerCount})...</p>
            )}
            {seats.length >= playerCount && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: 'rgba(76, 175, 80, 0.18)',
                  border: '1px solid rgba(120, 220, 130, 0.5)',
                  color: '#bfe8bf',
                  fontSize: 13,
                  fontWeight: 700,
                  textAlign: 'center',
                }}
              >
                ¡Están todos conectados! Ya se puede empezar.
              </div>
            )}
            {connectionRef.current.isMasterClient() ? (
              <button
                className="chunky-btn"
                onClick={() => (seats.length <= 1 ? setConfirmingSoloStart(true) : startGame())}
                disabled={seats.length > 1 && seats.length < playerCount}
                style={chunkyButtonStyle(seats.length <= 1 || seats.length >= playerCount)}
              >
                Empezar partida
              </button>
            ) : (
              seats.length >= playerCount && <p style={hintStyle}>Esperando a que el anfitrión empiece la partida...</p>
            )}
          </div>
        )}

        {confirmingSoloStart && (
          <div style={overlayStyle}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#f2ede0', textAlign: 'center' }}>¿Empezar solo/a?</div>
            <p style={{ ...hintStyle, textAlign: 'center', maxWidth: 260, marginTop: 0 }}>
              Las plazas vacías se llenarán con bots y nadie más va a poder unirse a esta sala después de esto.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="chunky-btn" onClick={() => setConfirmingSoloStart(false)} style={secondaryButtonStyle}>
                Cancelar
              </button>
              <button
                className="chunky-btn"
                onClick={() => {
                  setConfirmingSoloStart(false)
                  startGame()
                }}
                style={chunkyButtonStyle(true)}
              >
                Sí, empezar con bots
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const wrapperStyle: React.CSSProperties = {
  height: '100%',
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#f2ede0',
  fontFamily: 'system-ui, sans-serif',
  overflowY: 'auto',
  boxSizing: 'border-box',
  padding: '16px 0',
}

// Same carved-wood card as StartScreen's own title/button panel - reused as a plain style object
// (not a shared component) since each screen's internal layout differs enough that a shared
// wrapper component would need as many override props as it saves. Width/padding in clamp()/vw
// units, not a fixed 340/400px - reported directly (with a screenshot of the start screen clipping
// on a narrow phone) that a fixed size overflows small viewports; this card has the same shape of
// bug (more content stacked in it than StartScreen's, so more prone to it, not less).
const cardStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  padding: 'clamp(20px, 5vh, 36px) clamp(20px, 6vw, 44px)',
  borderRadius: 28,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent 25%), linear-gradient(165deg, rgba(58, 46, 30, 0.85), rgba(30, 23, 14, 0.85))',
  border: '2px solid #1a3468',
  boxShadow: '0 10px 30px rgba(0,0,0,0.5), inset 0 0 0 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
  width: 'min(400px, 92vw)',
  boxSizing: 'border-box',
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

// Same overlay/secondary-button recipe as GameBoardScreen's own exit-confirmation dialog (kept as
// a local copy, not a shared import, the same "each screen owns its own style objects" pattern
// every other style constant in this file already follows).
const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '0 16px',
  background: 'rgba(0,0,0,0.72)',
  borderRadius: 28,
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '11px 22px',
  fontSize: 15,
  fontWeight: 700,
  color: '#f2ede0',
  background: 'linear-gradient(165deg, rgba(255,255,255,0.1), rgba(255,255,255,0) 60%), rgba(58, 46, 30, 0.6)',
  border: '3px solid #c9a24b',
  borderRadius: 999,
  boxShadow: '0 5px 0 #1a3468, 0 8px 12px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.2)',
  cursor: 'pointer',
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
      ? 'linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0) 40%), linear-gradient(180deg, #dcebff 0%, #3d76e6 48%, #16409c 100%)'
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
    width: 'clamp(36px, 10vw, 44px)',
    height: 'clamp(36px, 10vw, 44px)',
    fontSize: 'clamp(14px, 4vw, 17px)',
    flexShrink: 0,
    fontWeight: 800,
    color: selected ? '#eef4ff' : '#c8d4ec',
    background: selected
      ? 'linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0) 40%), linear-gradient(180deg, #d4e4ff 0%, #6a94e8 55%, #3868c0 100%)'
      : 'linear-gradient(180deg, rgba(255,255,255,0.25), rgba(255,255,255,0) 40%), linear-gradient(180deg, #4a6aa0 0%, #345078 55%, #223a5a 100%)',
    border: `2px solid ${selected ? '#3868c0' : '#1a3468'}`,
    borderRadius: '50%',
    boxShadow: selected
      ? '0 3px 0 #24448c, 0 6px 10px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.6)'
      : '0 3px 0 #14253f, 0 5px 8px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.25)',
    cursor: 'pointer',
  }
}

// Same selected/unselected recipe as countButtonStyle, just a text-label pill instead of a
// single-digit circle - region codes/names need real width, not a fixed circular footprint.
function regionButtonStyle(selected: boolean): React.CSSProperties {
  return {
    padding: '7px 12px',
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
    color: selected ? '#eef4ff' : '#c8d4ec',
    background: selected
      ? 'linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0) 40%), linear-gradient(180deg, #d4e4ff 0%, #6a94e8 55%, #3868c0 100%)'
      : 'linear-gradient(180deg, rgba(255,255,255,0.25), rgba(255,255,255,0) 40%), linear-gradient(180deg, #4a6aa0 0%, #345078 55%, #223a5a 100%)',
    border: `2px solid ${selected ? '#3868c0' : '#1a3468'}`,
    borderRadius: 999,
    boxShadow: selected
      ? '0 3px 0 #24448c, 0 6px 10px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.6)'
      : '0 3px 0 #14253f, 0 5px 8px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.25)',
    cursor: 'pointer',
  }
}
