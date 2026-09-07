import { useEffect, useRef, useState } from 'react'
import { StartScreenBackground } from '../scene/StartScreenBackground'

function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const clamp = (c: number) => Math.max(0, Math.min(255, c))
  const r = clamp(((n >> 16) & 0xff) + Math.round(255 * amount))
  const g = clamp(((n >> 8) & 0xff) + Math.round(255 * amount))
  const b = clamp((n & 0xff) + Math.round(255 * amount))
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}
import { toBoardData } from '../core/board/boardDefinition'
import { createPlayerState } from '../core/gameFlow/playerState'
import { TurnManager } from '../core/gameFlow/turnManager'
import { getColor } from '../core/colorPalette'
import type { PieceColor } from '../core/pieceColor'
import { TURN_ORDER_BY_COUNT } from '../core/turnOrder'
import { defaultRuleSettings } from '../core/rules/ruleSettings'
import { BOARD_DEFINITIONS } from '../data/boards'
import { BotController } from '../core/gameFlow/botController'
import { QueueDice, RecordingDice } from '../online/dice'
import { HostTurnManagerBridge } from '../online/HostTurnManagerBridge'
import { PhotonConnection, type ActorInfo } from '../online/photonClient'
import type { GameMessage } from '../online/protocol'
import { RemoteTurnManager } from '../online/RemoteTurnManager'
import type { ColorDrawEntry } from './ColorDrawModal'
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

// Fixed Photon Realtime region - not exposed as a picker (see this file's own git history for the
// removed UI: it wasn't something the client ever asked for, and had no basis in the rulebook
// either, just an unrequested engineering nicety). The SDK's own "Best Region" ping-and-pick flow
// needs an extra connect-to-nameserver round trip and a several-second ping phase before the room
// UI can even appear, so a fixed default stays simpler and faster to reach the actual game.
const PHOTON_REGION = 'us'
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I - easier to read aloud/type

function generateRoomCode(): string {
  let code = ''
  for (let i = 0; i < 5; i++) code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]
  return code
}

// Reported directly, with a screenshot: a raw SDK internal message ("Client: Master: [203]
// PhotonPeer[_send] - Operation 226 - failed...") landed straight on screen. photonClient.ts's own
// rejections were always plain English reasons (or, before that file's own fix alongside this one,
// an occasional raw SDK string) meant to be translated here - per that file's own comment - but
// nothing here ever actually did the translating, so whatever came back from the promise just got
// interpolated directly into the displayed message. Matches on a substring rather than an exact
// string so this still degrades to the generic fallback (never a raw/English leak) if photonClient's
// own wording ever changes without this list being updated to match.
function friendlyOnlineError(rawMessage: string): string {
  if (rawMessage.includes('room does not exist')) return 'La sala no existe. Revisá el código.'
  if (rawMessage.includes('room is full')) return 'La sala ya está llena.'
  if (rawMessage.includes('room has already started')) return 'Esa partida ya empezó.'
  if (rawMessage.includes('room code already in use')) return 'Ese código de sala ya está en uso - probá de nuevo.'
  if (rawMessage.includes('lost connection') || rawMessage.includes('connection failed') || rawMessage.includes('not connected')) {
    return 'Se perdió la conexión con el servidor.'
  }
  return 'No se pudo conectar. Probá de nuevo en un momento.'
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

// Reported directly ("un carrusel para sortear el color de cada jugador" - a carousel to draw each
// player's color): unlike local play's own ColorSelector (a real, explicit "EL JUGADOR... DEBE
// PODER ELEGIR EL COLOR" choice - see that file's own comment - left untouched here), online play
// never had a color *choice* to begin with - colorsByActorNr above is a silent, deterministic
// function of join order (the room creator's own seat always lands on colors[0]). Drawing an
// actual random assignment instead, once, right when the game starts (not continuously as people
// join the lobby - see startGame()'s own call site) is a pure addition, nothing to reconcile with
// that other requirement. `colors` itself (the fixed turn-order list, e.g. TURN_ORDER_BY_COUNT)
// stays untouched - only *which seat* lands on which of those colors is shuffled, so every other
// piece of code that indexes into the original `colors` array for turn order keeps working
// unmodified.
function shuffleColorsByActorNr(actorNrs: readonly number[], colors: readonly PieceColor[]): Map<number, PieceColor> {
  const sorted = [...actorNrs].sort((a, b) => a - b)
  const shuffled = [...colors]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const map = new Map<number, PieceColor>()
  sorted.forEach((actorNr, rank) => map.set(actorNr, shuffled[rank] ?? shuffled[shuffled.length - 1]))
  return map
}

// Reported directly, next to the reference mockup's own icon badges: "use icons, not emoji" -
// emoji render as a different literal glyph per OS/browser (Apple's vs. Microsoft's vs. Google's
// own house/key/bulb pictures are all visually distinct, none of them this app's own art
// direction), where a real vector icon renders identically everywhere and can actually be
// colored/sized to match a button's own text. Plain inline SVGs, scoped to this file only (the
// "each screen owns its own style objects" convention - see this file's own comment on it
// elsewhere - extends to these too, since nothing else in the app had an icon set to share yet).
function PersonIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  )
}

function ArrowRightIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12h15" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  )
}

function ArrowLeftIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </svg>
  )
}

function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function BulbIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9 21h6v-1H9v1zm3-19C7.48 2 4 5.48 4 10c0 2.89 1.64 5.42 4 6.86V19h8v-2.14c2.36-1.44 4-3.97 4-6.86 0-4.52-3.48-8-8-8zm2 13.86V17h-4v-1.14c-2.36-1.02-4-3.28-4-5.86 0-3.31 2.69-6 6-6s6 2.69 6 6c0 2.58-1.64 4.84-4 5.86z" />
    </svg>
  )
}

function PencilIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
    </svg>
  )
}

type Phase = 'connecting' | 'error' | 'menu' | 'creating' | 'joining' | 'lobby' | 'game' | 'stopped'

export default function OnlineLobbyScreen() {
  const [phase, setPhase] = useState<Phase>('connecting')
  const [errorMessage, setErrorMessage] = useState('')
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

  // Reported directly, with a screenshot: hitting a connection error left the player stuck on a
  // dead-end screen with no way back - phase 'error' rendered the message and nothing else, and
  // the mount effect below only ever ran its connect() once for this component's whole lifetime.
  // Bumped by the "Reintentar" button (see the 'error' phase's own render below) specifically to
  // re-run that effect on demand: React tears down the previous connection via this same effect's
  // own cleanup (leaveRoom + disconnect) before setting up a fresh PhotonConnection and calling
  // connect() again, exactly what a real retry needs - reusing the old, possibly-broken connection
  // object instead wouldn't reliably recover from whatever state it died in.
  const [connectAttempt, setConnectAttempt] = useState(0)

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
      .connect(PHOTON_REGION)
      .then(() => setPhase('menu'))
      .catch((err: unknown) => {
        setErrorMessage(friendlyOnlineError(err instanceof Error ? err.message : String(err)))
        setPhase('error')
      })
    // See PhotonConnection's own leaveRoom() doc comment - a refresh or tab close never runs
    // React's own unmount cleanup below in time to matter, so this is the only chance to get the
    // explicit Leave operation out before the page actually tears down. pagehide fires more
    // reliably than beforeunload across mobile browsers and bfcache navigations (confirmed
    // directly against MDN's own compatibility notes) - registered for both since neither is
    // universally guaranteed on its own.
    const leaveOnUnload = () => connection.leaveRoom()
    window.addEventListener('pagehide', leaveOnUnload)
    window.addEventListener('beforeunload', leaveOnUnload)
    return () => {
      window.removeEventListener('pagehide', leaveOnUnload)
      window.removeEventListener('beforeunload', leaveOnUnload)
      botControllerRef.current?.dispose()
      connection.leaveRoom()
      connection.disconnect()
    }
  }, [connectAttempt])

  // Reported directly, with a screenshot: a player sitting on this exact "Jugar online" menu
  // screen clicked "Crear" and got a raw SDK error - the connection to the region master had
  // silently died sometime after connect() first resolved, with nothing here watching for it, so
  // the menu just sat there looking identical to a live connection until an operation actually
  // failed because of it. Scoped to the 'menu' phase specifically - see the *separate*
  // onConnectionLost subscription further below for 'lobby'/'game', which routes to a different
  // phase ('stopped', not 'error') since there's a live session to tear down there, not just a
  // menu to retry from.
  useEffect(() => {
    const connection = connectionRef.current
    if (!connection || phase !== 'menu') return
    return connection.onConnectionLost(() => {
      setErrorMessage(friendlyOnlineError('lost connection to the server'))
      setPhase('error')
    })
  }, [phase])

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
      startAsRemote(
        connection,
        props.startedColors as PieceColor[],
        props.startedSeats as Record<number, PieceColor>,
        (props.startedStartingPlayerRolls as number[]) ?? [],
      )
      return
    }
    return connection.onMessage((data) => {
      const msg = data as GameMessage
      if (msg.type !== 'gameStarted') return
      startAsRemote(connection, msg.colors, msg.seats, msg.startingPlayerRolls)
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

  // Reported directly (a stuck game after the room creator disconnected mid-match, the remaining
  // client left staring at "esperando el turno de X" forever): isMasterClient()/
  // onMasterClientChanged (roomTransport.ts's own doc comment: "can change mid-game if the previous
  // Master Client disconnects") were only ever consulted during the lobby phase before this - once
  // the game actually started, nothing here reacted to Photon promoting a new Master at all. A
  // client that started the game as a plain remote (RemoteTurnManager - only ever sends intents to
  // whoever is Master and replays *their* broadcasts) has no way to carry on once it becomes that
  // Master itself; its own session was never built to be authoritative. onActorLeft just above
  // already stops the game the instant any actor leaves, which should already cover the common
  // case - this is a second, independent safety net specifically for master promotion, in case that
  // event doesn't land the same way (e.g. a dropped connection Photon only detects via its own
  // timeout, not a clean leave). wasMasterRef captures this client's own master status once, right
  // when the game starts - a client that started the game *as* Master (already running
  // HostTurnManagerBridge) has nothing to do here even if this fires again later.
  const wasMasterRef = useRef(false)
  useEffect(() => {
    const connection = connectionRef.current
    if (!connection || phase !== 'game') return
    wasMasterRef.current = connection.isMasterClient()
    return connection.onMasterClientChanged(() => {
      if (wasMasterRef.current || !connection.isMasterClient()) return
      wasMasterRef.current = true
      botControllerRef.current?.dispose()
      botControllerRef.current = null
      session?.turnManager.dispose?.()
      setSession(null)
      setStopReason('El anfitrión se desconectó - la partida se detuvo.')
      setPhase('stopped')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Reported directly, with screenshots: the player who *joined* via room code was left frozen
  // mid-game (stuck on "esperando el turno de X", roll button disabled) while the *other* player's
  // own screen correctly showed "X salió de la sala" - a real, server-confirmed departure. Neither
  // onActorLeft nor onMasterClientChanged above ever catches THIS client's *own* connection dying,
  // only other actors leaving or the Master role changing - if this client's own device sleeps or
  // loses focus for long enough that Photon's server gives up on it, the server correctly tells
  // everyone *else* it left, but this client's own JavaScript (paused the whole time, same as its
  // network) never itself processes any "you've been disconnected" event upon waking: the local
  // self-teardown sweep (onActorLeave's own cleanup=true case) is deliberately ignored by
  // onActorLeft to avoid blaming an innocent other player for a hiccup on *this* client's own
  // connection (see photonClient.ts's own onActorLeft comment) - which means, without this,
  // *nothing at all* was watching for this client's own connection dying past the 'menu' phase.
  // onConnectionLost is scoped to 'lobby'/'game' here specifically (see the *separate*
  // 'menu'-scoped subscription above, which routes to 'error' instead - there's no live session to
  // tear down yet at that point).
  useEffect(() => {
    const connection = connectionRef.current
    if (!connection || (phase !== 'lobby' && phase !== 'game')) return
    return connection.onConnectionLost(() => {
      botControllerRef.current?.dispose()
      botControllerRef.current = null
      session?.turnManager.dispose?.()
      setSession(null)
      setStopReason('Se perdió la conexión con el servidor - la partida se detuvo.')
      setPhase('stopped')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  function startAsRemote(connection: PhotonConnection, colors: PieceColor[], seats: Record<number, PieceColor>, startingPlayerRolls: number[]) {
    const board = toBoardData(BOARD_DEFINITIONS[colors.length])
    const players = colors.map((color) => createPlayerState(color, board))
    const diceQueue = new QueueDice()
    const inner = new TurnManager(board, players, defaultRuleSettings(), diceQueue)
    // See GameStartedMessage's own doc comment - replays the Master's exact roll-off against this
    // client's own local `players` array before bridge.start(), same as every other broadcast here
    // is replayed rather than trusted directly.
    diceQueue.push(...startingPlayerRolls)
    const startingPlayerResult = inner.determineStartingPlayer()
    // Reported directly, found while wiring up the color carousel: recomputing colorsByActorNr
    // independently here was harmless while it was a pure, deterministic function of join order
    // (every client's own recompute always agreed) - but now that startGame() draws a *random*
    // assignment, a client independently recomputing its own random draw would diverge from the
    // Master's. `seats` is the Master's own already-decided mapping, broadcast for exactly this -
    // read from it directly instead, same as every other piece of Master-decided state here.
    const myColor = seats[connection.localActorNr] ?? null
    const bridge = new RemoteTurnManager(inner, diceQueue, players, connection, myColor ?? null)
    bridge.start()
    realSeatsRef.current = seats ?? {}
    // See ColorDrawModal's own doc comment - a color with no entry in `seats` (the Master's own
    // decided actorNr->color mapping) went to a bot.
    const claimedColors = new Set(Object.values(seats ?? {}))
    const colorDraw: ColorDrawEntry[] = colors.map((color) => ({ color, isBot: !claimedColors.has(color) }))
    setSession({ turnManager: bridge, players, startingPlayerResult, colorDraw })
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
        setErrorMessage(friendlyOnlineError(err instanceof Error ? err.message : String(err)))
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
        setErrorMessage(friendlyOnlineError(err instanceof Error ? err.message : String(err)))
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

    // See GameStartedMessage's own doc comment - runs before bridge.start() so currentPlayerIndex
    // is already correct the instant the very first turnStarted fires, and drains its own recorded
    // rolls off the same `dice` HostTurnManagerBridge is about to take over broadcasting for.
    const startingPlayerResult = inner.determineStartingPlayer()
    const startingPlayerRolls = dice.drain()

    // See shuffleColorsByActorNr's own doc comment - drawn once, right here, not as seats fill in
    // the lobby (the lobby's own seat-list preview below still shows the plain join-order mapping
    // right up until this point, matching "you don't know your color until the draw happens").
    const actorColors = shuffleColorsByActorNr(connection.getActors().map((a) => a.actorNr), colors)
    const myColor = actorColors.get(connection.localActorNr) ?? null
    const bridge = new HostTurnManagerBridge(inner, dice, players, connection, actorColors, myColor)

    // Any color nobody claimed a seat for becomes a bot - this is what "bots fill empty seats" means.
    const claimedColors = new Set(actorColors.values())
    const botColors = new Set(colors.filter((c) => !claimedColors.has(c)))
    if (botColors.size > 0) botControllerRef.current = new BotController(bridge, botColors)
    const colorDraw: ColorDrawEntry[] = colors.map((color) => ({ color, isBot: botColors.has(color) }))

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
    connection.setRoomProperties({ started: true, startedColors: colors, startedSeats: realSeatsRef.current, startedStartingPlayerRolls: startingPlayerRolls })
    connection.broadcast({ type: 'gameStarted', colors, seats: realSeatsRef.current, startingPlayerRolls })
    // botPieceHighlighted only ever comes from *this* client's own BotController - bots are only
    // ever driven by the Master (see this file's own doc comment on that), so a non-Master client
    // has no local BotController and its board simply never shows this specific extra cue, same as
    // every other host-only aspect of driving the bots themselves.
    setSession({ turnManager: bridge, players, botPieceHighlighted: botControllerRef.current?.pieceHighlighted, startingPlayerResult, colorDraw })
    setPhase('game')
  }

  if (phase === 'game' && session) {
    return <GameBoardScreen definition={BOARD_DEFINITIONS[playerCount]} session={session} onExit={() => (window.location.hash = '')} />
  }

  // Reported directly, with a reference mockup image and a screenshot of the plain carved-wood
  // card every other phase still uses: "make it match this style exactly". Scoped to the 'menu'
  // phase only, as its own early return - every other phase (connecting/error/stopped/creating/
  // joining/lobby, all reachable mid-flow, none of them what the mockup was actually of) keeps the
  // original compact cardStyle rendering below completely untouched. logo-badge.png (the existing
  // small circular badge) stands in for the mockup's own larger illustrated mascot/full logo
  // lockup until that asset is dropped into the project - swap the header badge's src once it is.
  if (phase === 'menu') {
    return (
      <div style={wrapperStyle}>
        {/* Reported directly, with a screenshot circling it: the blurred 3D board scene showing
            through/around the panel (StartScreenBackground, shared with every other phase below)
            read as a leftover "yellowish" backdrop clashing with this phase's own colorful cards
            - dropped in favor of a plain flat fill, scoped to 'menu' only like the rest of this
            redesign. */}
        <div style={{ position: 'absolute', inset: 0, backgroundColor: '#05070c' }} />
        <div style={menuPanelStyle}>
          {/* Reported directly, with a screenshot circling this exact block: the badge/wordmark/
              tagline header was asked to be removed outright, not just resized - see the earlier
              size-fix commit for the same block, still shrunk down at the time this went. Only
              the close button survives, now alone at top-right. */}
          <div style={menuHeaderRowStyle}>
            <button
              className="chunky-btn"
              onClick={() => (window.location.hash = '')}
              style={menuCloseButtonStyle}
              aria-label="Cerrar"
            >
              <CloseIcon size={15} />
            </button>
          </div>

          {/* Reported directly: "don't crop it - use the file exactly as it is, the one with the
              dice and the text." The earlier crops (first the mockup screenshot itself, then a
              tighter crop of the client's own better-isolated cutout) were each trimmed down to
              just the hooded figure so this app's own coded "Jugar online" plaque underneath
              wouldn't duplicate its baked-in text - now dropped entirely in favor of showing that
              whole image (mascot, wooden "Jugar online" sign with its own subtitle/description,
              and the dice) untouched, exactly as supplied. */}
          <img
            src="/parkiller-mascot.png"
            alt="Jugar online - Creá una sala o unite con un código"
            style={menuMascotStyle}
          />

          <div style={{ ...menuDoodleStyle, alignSelf: 'flex-end', marginRight: 'clamp(4px, 4vw, 24px)', display: 'flex', alignItems: 'center', gap: 6 }}>
            ¡Vamos a jugar! <PencilIcon size={17} />
          </div>

          <div style={menuCardsRowStyle}>
            {/* Reported directly, with the client's own two card-frame art files saved into
                public/backgrounds/ (leftbg.png for this "Crear sala" card, bluebg.png for
                "Unirse a sala" below) - the glossy glow border, corner crown/star decorations,
                and icon badge that this file previously hand-coded in CSS (menuCardBadgeStyle,
                GroupIcon/LinkIcon, the plain gradient+border card recipe) are all baked into
                these images already, so the coded versions are dropped in favor of the real
                artwork; only the badge's own blank space below it still needs paddingTop to clear. */}
            <div style={menuCardStyle('/backgrounds/leftbg.png')}>
              <h3 style={menuCardTitleStyle}>
                Crear <span style={{ color: '#79e39a' }}>sala</span>
              </h3>
              <p style={menuCardSubtitleStyle}>Elige el número de jugadores y crea tu propia sala.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                {[2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    className="chunky-btn"
                    onClick={() => setPlayerCount(n)}
                    style={menuCountButtonStyle(n === playerCount, '#3fae66')}
                  >
                    <PersonIcon size={13} />
                    {n}
                  </button>
                ))}
              </div>
              <button className="chunky-btn" onClick={createRoom} style={coloredButtonStyle(true, '#3fae66')}>
                Crear sala
                <ArrowRightIcon size={17} />
              </button>
            </div>

            <div style={menuCardStyle('/backgrounds/bluebg.png')}>
              <h3 style={menuCardTitleStyle}>
                Unirse <span style={{ color: '#8ec4f5' }}>a sala</span>
              </h3>
              <p style={menuCardSubtitleStyle}>Ingresa el código de la sala para unirte a la partida.</p>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12 }}>
                <input
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value)}
                  placeholder="CÓDIGO DE SALA"
                  style={inputStyle}
                />
              </div>
              <button
                className="chunky-btn"
                onClick={joinRoom}
                disabled={!roomCodeInput.trim()}
                style={coloredButtonStyle(Boolean(roomCodeInput.trim()), '#3f8ee0')}
              >
                Unirse a sala
                <ArrowRightIcon size={17} />
              </button>
            </div>
          </div>

          <div style={menuTipBannerStyle}>
            <BulbIcon size={19} />
            <span>Tip: compartí el código de sala con tus amigos para armarla juntos</span>
          </div>

          <button className="chunky-btn" onClick={() => (window.location.hash = '')} style={menuBackButtonStyle}>
            <ArrowLeftIcon size={15} /> Volver
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={wrapperStyle}>
      {/* backgroundColor here matches StartScreenBackground's own internal fog color - see
          PlayerCountSelector's own matching comment (same fix) for why. */}
      <div style={{ position: 'absolute', inset: 0, backgroundColor: '#05070c' }}>
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
          <h1 style={{ margin: 0, fontSize: 'clamp(21px, 6vw, 28px)', fontWeight: 800, color: '#e8cf8a', textShadow: '0 2px 0 #7a5f26, 0 4px 10px rgba(0,0,0,0.5)' }}>
            Jugar online
          </h1>
        </div>

        {phase === 'connecting' && <p style={hintStyle}>Conectando a Photon...</p>}

        {phase === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, width: '100%' }}>
            <p style={{ ...hintStyle, color: '#e8a15c', fontSize: 15 }}>{errorMessage}</p>
            <button className="chunky-btn" onClick={() => setConnectAttempt((n) => n + 1)} style={chunkyButtonStyle(true)}>
              Reintentar
            </button>
          </div>
        )}

        {phase === 'stopped' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, width: '100%' }}>
            <p style={{ ...hintStyle, color: '#e8a15c', fontSize: 15 }}>{stopReason}</p>
            <button className="chunky-btn" onClick={() => setPhase('menu')} style={chunkyButtonStyle(true)}>
              Volver al menú
            </button>
          </div>
        )}

        {(phase === 'creating' || phase === 'joining') && <p style={hintStyle}>...</p>}

        {phase === 'lobby' && connectionRef.current && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
            <div style={sectionStyle}>
              <div style={hintStyle}>Código de sala</div>
              <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 3, color: '#e8cf8a', textShadow: '0 2px 0 #7a5f26' }}>{roomCode}</div>
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
                        {occupant ? (occupant.isLocal ? '(usted)' : 'jugador conectado') : 'esperando jugador...'}
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
  border: '2px solid #7a5f26',
  boxShadow: '0 10px 30px rgba(0,0,0,0.5), inset 0 0 0 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
  width: 'min(400px, 92vw)',
  boxSizing: 'border-box',
}

const sectionStyle: React.CSSProperties = {
  padding: '16px 18px',
  borderRadius: 14,
  background: 'rgba(0,0,0,0.2)',
  border: '1px solid rgba(201,162,75,0.35)',
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
  border: '1px solid rgba(201,162,75,0.22)',
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
  color: '#e8cf8a',
  background: 'rgba(0,0,0,0.35)',
  border: '2px solid #7a5f26',
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
  boxShadow: '0 5px 0 #7a5f26, 0 8px 12px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.2)',
  cursor: 'pointer',
}

// Same chunky carved-wood recipe used across StartScreen/PlayerCountSelector/GameBoardScreen: a
// solid (non-blurred) offset bottom edge reads as physical depth, not just a bigger shadow.
// Reported directly (Carlos's own "life journey" philosophy - camaraderie over competition): this
// whole screen was still the one place in the app fully in the old cold-blue chrome (buttons,
// panel borders, headings) - never got the warm-gold pass the pre-game flow and in-game HUD both
// already had. Primary actions here (create/join/start) now use the same warm gold "this is
// active" language as everywhere else instead of a leftover corporate blue.
function chunkyButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '14px 24px',
    fontSize: 17,
    fontWeight: 800,
    letterSpacing: 0.3,
    color: enabled ? '#fff6e0' : '#8a8a80',
    background: enabled
      ? 'linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0) 40%), linear-gradient(180deg, #f5e2ae 0%, #c9a24b 48%, #7a5f26 100%)'
      : 'linear-gradient(180deg, #8a8a80, #6a6a60)',
    border: `3px solid ${enabled ? '#7a5f26' : '#4a4a44'}`,
    borderRadius: 16,
    boxShadow: enabled
      ? '0 5px 0 #7a5f26, 0 9px 16px rgba(0,0,0,0.4), inset 0 2px 1px rgba(255,255,255,0.55)'
      : '0 5px 0 #3a3a34, 0 8px 12px rgba(0,0,0,0.3)',
    textShadow: enabled ? '0 1px 2px rgba(40,24,8,0.5)' : 'none',
    cursor: enabled ? 'pointer' : 'default',
  }
}

// Reported directly, next to the reference mockup's own player-count row: a rounded-square badge
// per count, uniform in the card's own theme color (not this app's usual candy-jar rainbow - see
// PlayerCountSelector.tsx's own identical picker for that convention, deliberately NOT reused
// here since the mockup's own count badges are a single hue per card, muted until selected) with
// a small person glyph above the number, selected state glowing in the same hue rather than
// swapping to a brighter color entirely.
function menuCountButtonStyle(selected: boolean, hex: string): React.CSSProperties {
  const dark = lighten(hex, -0.62)
  const darker = lighten(hex, -0.72)
  return {
    width: 42,
    height: 42,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    flexShrink: 0,
    fontFamily: "'Baloo 2', system-ui, sans-serif",
    fontSize: 14,
    fontWeight: 800,
    color: selected ? '#fff' : 'rgba(255,255,255,0.65)',
    background: selected
      ? `linear-gradient(165deg, ${lighten(hex, 0.15)}, ${hex})`
      : `linear-gradient(165deg, ${dark}, ${darker})`,
    border: `2px solid ${selected ? lighten(hex, 0.4) : 'rgba(255,255,255,0.12)'}`,
    borderRadius: 12,
    boxShadow: selected ? `0 0 0 3px ${hex}55, 0 3px 8px rgba(0,0,0,0.35)` : 'inset 0 1px 2px rgba(0,0,0,0.3)',
    cursor: 'pointer',
  }
}

// --- 'menu' phase only, below - see that phase's own early-return above for why it's a fully
// separate layout rather than another branch inside cardStyle. Wider panel (two side-by-side
// cards need more room than the 400px compact card every other phase still uses), and its own
// header/plaque/tip-banner styles that don't apply anywhere else in this file.

const menuPanelStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  padding: 'clamp(14px, 2.5vh, 24px) clamp(16px, 4.5vw, 32px)',
  borderRadius: 28,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent 25%), linear-gradient(165deg, rgba(58, 46, 30, 0.85), rgba(30, 23, 14, 0.85))',
  border: '2px solid #7a5f26',
  boxShadow: '0 10px 30px rgba(0,0,0,0.5), inset 0 0 0 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
  width: 'min(760px, 94vw)',
  maxHeight: '94vh',
  overflowY: 'auto',
  boxSizing: 'border-box',
}

const menuHeaderRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
}

const menuCloseButtonStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  minWidth: 40,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 18,
  fontWeight: 800,
  color: '#e8cf8a',
  background: 'linear-gradient(165deg, rgba(255,255,255,0.1), rgba(255,255,255,0) 60%), rgba(58, 46, 30, 0.6)',
  border: '2px solid #7a5f26',
  boxShadow: '0 4px 0 #4a3a1a, 0 6px 10px rgba(0,0,0,0.35)',
  cursor: 'pointer',
  flexShrink: 0,
}

// Full width of the panel's own content area rather than a small fixed footprint - the whole
// image (mascot, its wooden "Jugar online" sign, and the dice) is the header now, not just a
// small accent above a separate coded plaque, so it needs to actually read at a glance.
const menuMascotStyle: React.CSSProperties = {
  display: 'block',
  alignSelf: 'center',
  width: 'min(360px, 88%)',
  height: 'auto',
}

// Caveat (a handwritten-style Google Font, loaded in index.html for exactly this) for the
// mockup's own scattered hand-drawn annotations - the one place in the whole app that isn't the
// carved-wood Baloo2/system-ui look, deliberately, to read as a marker doodle rather than UI copy.
const menuDoodleStyle: React.CSSProperties = {
  fontFamily: "'Caveat', cursive",
  fontWeight: 700,
  fontSize: 'clamp(20px, 4.5vw, 26px)',
  color: '#f5e2a8',
  transform: 'rotate(-4deg)',
  textShadow: '0 2px 6px rgba(0,0,0,0.4)',
}

const menuCardsRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 14,
  flexWrap: 'wrap',
}

// The client's own card-frame art (leftbg.png/bluebg.png) already bakes in the glow border,
// corner crown/star decorations, the icon badge, and the bottom wave - this file's own earlier
// hand-coded gradient+border card recipe and separate circular icon badge (menuCardBadgeStyle,
// GroupIcon/LinkIcon) are dropped entirely in favor of it. backgroundSize '100% 100%' stretches
// the art to match this card's own actual (content-driven) height exactly, since the two rarely
// match the source image's own fixed aspect ratio pixel-for-pixel; overflow hidden is a safety
// clip in case any real height still spills past the image's own rounded corners. paddingTop
// clears the image's own baked-in badge before this card's real title/content starts.
function menuCardStyle(imageUrl: string): React.CSSProperties {
  return {
    flex: '1 1 260px',
    minWidth: 240,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: 10,
    padding: '88px 18px 20px',
    borderRadius: 30,
    overflow: 'hidden',
    backgroundImage: `url(${imageUrl})`,
    backgroundSize: '100% 100%',
    backgroundRepeat: 'no-repeat',
    boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
  }
}

const menuCardTitleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "'Baloo 2', system-ui, sans-serif",
  fontSize: 21,
  fontWeight: 800,
  color: '#fff6e0',
  textShadow: '0 2px 4px rgba(0,0,0,0.4)',
}

const menuCardSubtitleStyle: React.CSSProperties = {
  margin: '-4px 0 2px',
  fontSize: 12.5,
  lineHeight: 1.4,
  color: 'rgba(242,237,224,0.75)',
  maxWidth: 220,
}

// Same carved-3D recipe as chunkyButtonStyle above, parameterized by hue instead of the fixed
// gold - the two menu cards need their own green/blue "this is active" color, not the app's usual
// single gold accent every other button in the file still uses untouched.
function coloredButtonStyle(enabled: boolean, hex: string): React.CSSProperties {
  const light = lighten(hex, 0.35)
  const dark = lighten(hex, -0.35)
  return {
    width: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '11px 22px',
    fontSize: 16,
    fontWeight: 800,
    letterSpacing: 0.3,
    fontFamily: "'Baloo 2', system-ui, sans-serif",
    color: enabled ? '#fff6e0' : '#8a8a80',
    background: enabled
      ? `linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0) 40%), linear-gradient(180deg, ${light} 0%, ${hex} 48%, ${dark} 100%)`
      : 'linear-gradient(180deg, #8a8a80, #6a6a60)',
    border: `3px solid ${enabled ? dark : '#4a4a44'}`,
    borderRadius: 999,
    boxShadow: enabled
      ? `0 5px 0 ${dark}, 0 9px 16px rgba(0,0,0,0.4), inset 0 2px 1px rgba(255,255,255,0.55)`
      : '0 5px 0 #3a3a34, 0 8px 12px rgba(0,0,0,0.3)',
    textShadow: enabled ? '0 1px 2px rgba(0,0,0,0.35)' : 'none',
    cursor: enabled ? 'pointer' : 'default',
  }
}

const menuTipBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '9px 14px',
  borderRadius: 14,
  border: '2px dashed rgba(232,207,138,0.5)',
  background: 'rgba(0,0,0,0.2)',
  fontFamily: "'Caveat', cursive",
  fontWeight: 700,
  fontSize: 'clamp(16px, 3.5vw, 19px)',
  color: '#f5e2a8',
}

const menuBackButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  alignSelf: 'center',
  width: 'auto',
  padding: '10px 26px',
}

