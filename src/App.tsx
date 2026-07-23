import { useState } from 'react'
import type { PieceColor } from './core/pieceColor'
import { BOARD_DEFINITIONS } from './data/boards'
import { GameBoardScreen } from './ui/GameBoardScreen'
import { PlayerCountSelector } from './ui/PlayerCountSelector'
import { StartScreen } from './ui/StartScreen'
import WaypointEditor from './tools/WaypointEditor'

const DEFAULT_COLOR_ORDER: PieceColor[] = ['Red', 'Blue', 'Gold', 'Green', 'Purple', 'Orange']

type Screen = 'start' | 'selectCount' | 'game'

export default function App() {
  const [screen, setScreen] = useState<Screen>('start')
  const [playerCount, setPlayerCount] = useState(4)

  // Dev-only route: open with #editor to trace board waypoints. See src/tools/WaypointEditor.tsx.
  if (window.location.hash === '#editor') {
    return <WaypointEditor />
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
          colors={DEFAULT_COLOR_ORDER.slice(0, playerCount)}
          onExit={() => setScreen('start')}
        />
      )}
    </div>
  )
}
