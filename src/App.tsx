import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { beginLocalGame } from './core/gameFlow/localGameSession'
import { TURN_ORDER_BY_COUNT } from './core/turnOrder'
import type { PieceColor } from './core/pieceColor'
import { BOARD_DEFINITIONS } from './data/boards'
import { ColorSelector } from './ui/ColorSelector'
import { pauseIntroMusic, playIntroMusic } from './ui/introMusic'
import { PlayerCountSelector } from './ui/PlayerCountSelector'
import { StartScreen } from './ui/StartScreen'
import { preloadTexture } from './scene/useRobustTexture'

// Reported directly ("이오락의 로딩속도가 매우느리다" - this game's loading speed is very slow):
// every one of these used to be a plain top-level import, so the whole app - the entire Three.js/
// @react-three/fiber 3D engine (GameBoardScreen's own BoardScene), Photon Realtime's SDK
// (OnlineLobbyScreen), and three dev-only tools no real player ever reaches at all - had to
// download and parse before even the start screen could paint, confirmed directly in the build's
// own output warning (a single ~1.34MB/383KB-gzipped chunk). Splitting each into its own
// lazy-loaded chunk means a player who never opens a dev tool or online play never downloads that
// code at all, and the start/player-count/color screens (plain 2D UI, none of them import
// anything from scene/) can paint and become interactive without waiting on the 3D engine first.
// gameBoardScreenImport is called directly (not just handed to lazy()) in the preload effect below
// so that fetch starts immediately instead of waiting for the player to actually reach the game
// screen - same "start the fetch early, let real setup-screen interaction time cover it" pattern
// this file's own preloadTexture calls already use for board art.
const gameBoardScreenImport = () => import('./ui/GameBoardScreen').then((m) => ({ default: m.GameBoardScreen }))
const GameBoardScreen = lazy(gameBoardScreenImport)
const WaypointEditor = lazy(() => import('./tools/WaypointEditor'))
const ComponentPreview = lazy(() => import('./tools/ComponentPreview'))
const ParkillerEditor = lazy(() => import('./tools/ParkillerEditor'))
const OnlineLobbyScreen = lazy(() => import('./ui/OnlineLobbyScreen'))

type Screen = 'start' | 'selectCount' | 'selectColor' | 'game'

// Matches the PWA manifest's own background_color - a plain dark fill reads as "still loading",
// not a jarring flash-of-white, for whatever brief moment (if any - GameBoardScreen's own chunk is
// pre-fetched well ahead of time, see the mount effect below) a lazy-loaded screen's chunk is still
// in flight.
function LazyScreenFallback() {
  return <div style={{ height: '100vh', background: '#1a1310' }} />
}

// Reported directly (a client screenshot still on an old, pre-redesign build days after it
// shipped - production itself was confirmed serving the current version at that exact moment):
// registerType 'autoUpdate' (vite.config.ts) only auto-applies an update the browser has already
// found - it doesn't make the browser go looking. By default that check only happens once, on
// this navigation; a tab kept open across many real testing sessions (exactly how this app tends
// to get used) can sit on a stale cached build for as long as it stays open, no matter how many
// times the real deployment moves on underneath it. Polling registration.update() here forces a
// fresh check periodically even on a long-lived tab - once a genuinely new service worker is
// found, 'autoUpdate' mode still takes it from there (installs, activates, reloads) with no
// further code needed here.
const SW_UPDATE_CHECK_INTERVAL_MS = 20 * 60 * 1000

export default function App() {
  useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      setInterval(() => {
        registration.update()
      }, SW_UPDATE_CHECK_INTERVAL_MS)
    },
  })

  const [screen, setScreen] = useState<Screen>('start')
  const [playerCount, setPlayerCount] = useState(4)
  // Reported directly, with a video: the board still flashes plain/white for a brief moment the
  // very first time it's shown in a session, even after useRobustTexture's own retry/fallback fix -
  // a healthy fetch still takes real time, and that first moment was always right as the game
  // screen itself mounted, the earliest point anything actually asked for that image.
  //
  // First attempt at this preloaded all 5 boards unconditionally on mount, reasoning that there's
  // no way to know the eventual choice in advance - reported again immediately after, still a long
  // wait, and reproduced directly under throttled network conditions: fetching all 5 at once means
  // they all compete for the same limited bandwidth, so whichever one the player actually picked
  // takes *longer* to arrive than it would alone, not shorter - counterproductive on exactly the
  // slow connections this was meant to help, even though it looked like a clear win on a fast one
  // (broadband/localhost) where bandwidth was never the bottleneck to begin with. Preloading only
  // the currently-relevant board - the same one the decorative start-screen background is already
  // showing - keeps the same head start (still fires well before the player reaches the color
  // screen or the real game board) without diluting bandwidth across boards that will never be
  // used this session. Effect re-fires as `playerCount` changes (PlayerCountSelector's own
  // onConfirm), so picking a different count immediately reprioritizes to that one.
  useEffect(() => {
    preloadTexture(BOARD_DEFINITIONS[playerCount].boardImage)
    preloadTexture('/tiles/tile-fill.png')
    preloadTexture('/tiles/tile-border.png')
  }, [playerCount])
  // Fires once, unconditionally, regardless of playerCount - every game reaches GameBoardScreen
  // eventually, so there's no "which one" question the way there is for board art. Starting this
  // fetch on mount (not on reaching the game screen) gives it the whole start/count/color setup
  // flow's own real time to finish in the background - see this file's own top comment.
  useEffect(() => {
    gameBoardScreenImport()
  }, [])
  // null means classic hotseat (every color passed around one device) - see ColorSelector's own
  // "Jugar todos los colores" option. Non-null means vs-bots: the human plays only this color,
  // every other color in this count's own TURN_ORDER_BY_COUNT is bot-driven.
  const [humanColor, setHumanColor] = useState<PieceColor | null>(null)
  // Only actually used once screen === 'game', but built unconditionally here (not inside that
  // conditional branch below) since hooks can't be called conditionally - cheap to construct
  // early, and beginLocalGame's own turnStarted emit is harmless before anything's listening.
  // Rebuilt whenever playerCount OR humanColor changes - a stale session (and, in vs-bots mode,
  // its own still-running BotController) must never survive into the next game; see the cleanup
  // effect just below for why that needs its own explicit disposal, not just letting it be
  // garbage-collected.
  const localSession = useMemo(
    () => beginLocalGame(BOARD_DEFINITIONS[playerCount], TURN_ORDER_BY_COUNT[playerCount], humanColor ?? undefined),
    [playerCount, humanColor],
  )
  // vs-bots mode's own BotController holds pending setTimeouts (see botController.ts) that must be
  // cleared before the next session replaces this one, or a bot from a *previous* game could still
  // fire a stale roll/move into whatever session happens to exist by then - the exact same disposal
  // OnlineLobbyScreen already does for its own BotController on unmount/room change.
  useEffect(() => {
    return () => localSession.dispose?.()
  }, [localSession])

  // Reading window.location.hash directly (as this used to) never re-renders on its own - setting
  // the hash doesn't touch React state, so OnlineLobbyScreen's own onExit (`location.hash = ''`)
  // had no effect: this component just kept rendering it forever. Reported directly as the online
  // screen's "Salir" button doing nothing and its Photon connection never actually disconnecting
  // (its cleanup only runs on unmount, which never came). Tracking the hash in state, updated by
  // the browser's own hashchange event, makes every hash-based route (including the dev-only ones
  // below) actually reactive.
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Requested directly ("habría que ponerle alguna música a la introducción del juego"): plays
  // while the player is still setting a game up (start/player-count/color screens), not once real
  // gameplay (or a dev-only tool, or online play - a separate mode with its own concerns) has
  // actually started. introMusic.ts's own play/pause are safe to call repeatedly - this just
  // re-asserts the right state on every render rather than tracking a previous value.
  useEffect(() => {
    if (screen !== 'game' && hash === '') playIntroMusic()
    else pauseIntroMusic()
  }, [screen, hash])

  // Dev-only route: open with #editor to trace board waypoints. See src/tools/WaypointEditor.tsx.
  if (hash === '#editor') {
    return (
      <Suspense fallback={<LazyScreenFallback />}>
        <WaypointEditor />
      </Suspense>
    )
  }
  // Dev-only route: open with #component to inspect a single track-square component in
  // isolation, with nothing else rendered. See src/tools/ComponentPreview.tsx.
  if (hash === '#component') {
    return (
      <Suspense fallback={<LazyScreenFallback />}>
        <ComponentPreview />
      </Suspense>
    )
  }
  // Dev-only route: click-trace the Parkiller piece's body/hood silhouette against the reference
  // photo with a live 3D preview alongside it. See src/tools/ParkillerEditor.tsx.
  if (hash === '#parkiller-editor') {
    return (
      <Suspense fallback={<LazyScreenFallback />}>
        <ParkillerEditor />
      </Suspense>
    )
  }
  // Milestone 2: online play via Photon Realtime, linked from StartScreen's "Jugar online" button
  // once VITE_PHOTON_APP_ID is configured. See src/ui/OnlineLobbyScreen.tsx.
  if (hash === '#online') {
    return (
      <Suspense fallback={<LazyScreenFallback />}>
        <OnlineLobbyScreen />
      </Suspense>
    )
  }

  return (
    <div style={{ height: '100vh' }}>
      {screen === 'start' && <StartScreen onPlayLocal={() => setScreen('selectCount')} />}
      {screen === 'selectCount' && (
        <PlayerCountSelector
          onConfirm={(count) => {
            setPlayerCount(count)
            setScreen('selectColor')
          }}
        />
      )}
      {screen === 'selectColor' && (
        <ColorSelector
          colors={TURN_ORDER_BY_COUNT[playerCount]}
          onConfirm={(color) => {
            setHumanColor(color)
            setScreen('game')
          }}
        />
      )}
      {screen === 'game' && (
        <Suspense fallback={<LazyScreenFallback />}>
          <GameBoardScreen
            definition={BOARD_DEFINITIONS[playerCount]}
            session={localSession}
            onExit={() => setScreen('start')}
          />
        </Suspense>
      )}
    </div>
  )
}
