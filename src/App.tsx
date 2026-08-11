import { useMemo, useState } from 'react'
import type { PieceColor } from './core/pieceColor'
import { beginLocalGame } from './core/gameFlow/localGameSession'
import { BOARD_DEFINITIONS } from './data/boards'
import { GameBoardScreen } from './ui/GameBoardScreen'
import { PlayerCountSelector } from './ui/PlayerCountSelector'
import { StartScreen } from './ui/StartScreen'
import WaypointEditor from './tools/WaypointEditor'
import ComponentPreview from './tools/ComponentPreview'

// Turn order (who goes first, then next, etc.) requested per player count - not the same as each
// board's own playerLanes order, which only fixes where each color's yard/track sits spatially.
const TURN_ORDER_BY_COUNT: Record<number, PieceColor[]> = {
  2: ['Red', 'Blue'],
  3: ['Red', 'Gold', 'Blue'],
  4: ['Green', 'Blue', 'Gold', 'Red'],
  5: ['Red', 'Green', 'Purple', 'Gold', 'Blue'],
  6: ['Orange', 'Green', 'Red', 'Purple', 'Gold', 'Blue'],
}

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

  // Dev-only route: open with #editor to trace board waypoints. See src/tools/WaypointEditor.tsx.
  if (window.location.hash === '#editor') {
    return <WaypointEditor />
  }
  // Dev-only route: open with #component to inspect a single track-square component in
  // isolation, with nothing else rendered. See src/tools/ComponentPreview.tsx.
  if (window.location.hash === '#component') {
    return <ComponentPreview />
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
