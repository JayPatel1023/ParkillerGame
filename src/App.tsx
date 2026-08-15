import { useEffect, useMemo, useState } from 'react'
import { beginLocalGame } from './core/gameFlow/localGameSession'
import { TURN_ORDER_BY_COUNT } from './core/turnOrder'
import { BOARD_DEFINITIONS } from './data/boards'
import { GameBoardScreen } from './ui/GameBoardScreen'
import { PlayerCountSelector } from './ui/PlayerCountSelector'
import { StartScreen } from './ui/StartScreen'
import WaypointEditor from './tools/WaypointEditor'
import ComponentPreview from './tools/ComponentPreview'
import ParkillerEditor from './tools/ParkillerEditor'
import OnlineLobbyScreen from './ui/OnlineLobbyScreen'

type Screen = 'start' | 'selectCount' | 'game'

export default function App() {
  const [screen, setScreen] = useState<Screen>('start')
  const [playerCount, setPlayerCount] = useState(4)
  // Only actually used once screen === 'game', but built unconditionally here (not inside that
  // conditional branch below) since hooks can't be called conditionally - cheap to construct
  // early, and beginLocalGame's own turnStarted emit is harmless before anything's listening.
  const localSession = useMemo(
    () => beginLocalGame(BOARD_DEFINITIONS[playerCount], TURN_ORDER_BY_COUNT[playerCount]),
    [playerCount],
  )

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

  // Dev-only route: open with #editor to trace board waypoints. See src/tools/WaypointEditor.tsx.
  if (hash === '#editor') {
    return <WaypointEditor />
  }
  // Dev-only route: open with #component to inspect a single track-square component in
  // isolation, with nothing else rendered. See src/tools/ComponentPreview.tsx.
  if (hash === '#component') {
    return <ComponentPreview />
  }
  // Dev-only route: click-trace the Parkiller piece's body/hood silhouette against the reference
  // photo with a live 3D preview alongside it. See src/tools/ParkillerEditor.tsx.
  if (hash === '#parkiller-editor') {
    return <ParkillerEditor />
  }
  // Milestone 2: online play via Photon Realtime, linked from StartScreen's "Jugar online" button
  // once VITE_PHOTON_APP_ID is configured. See src/ui/OnlineLobbyScreen.tsx.
  if (hash === '#online') {
    return <OnlineLobbyScreen />
  }

  return (
    <div style={{ height: '100vh' }}>
      {screen === 'start' && <StartScreen onPlayLocal={() => setScreen('selectCount')} />}
      {screen === 'selectCount' && (
        <PlayerCountSelector
          onConfirm={(count) => {
            setPlayerCount(count)
            setScreen('game')
          }}
        />
      )}
      {screen === 'game' && (
        <GameBoardScreen
          definition={BOARD_DEFINITIONS[playerCount]}
          session={localSession}
          onExit={() => setScreen('start')}
        />
      )}
    </div>
  )
}
