import { useMemo, useRef, useState } from 'react'
import type { BoardDefinition } from '../core/board/boardDefinition'
import { getColor } from '../core/colorPalette'
import { BOARD_DEFINITIONS } from '../data/boards'

type PlacementTarget = { kind: 'track' } | { kind: 'yard' | 'corridor'; laneIndex: number } | null

function cloneDefinition(def: BoardDefinition): BoardDefinition {
  return JSON.parse(JSON.stringify(def))
}

// Dev-only tool (see App.tsx, reached via #editor): trace a board's track/yards/corridors by
// clicking directly over the art, instead of hand-typing coordinates. Replaces the Unity Editor
// waypoint tool for this stack. Export the JSON and paste it into src/data/boards.ts.
export default function WaypointEditor() {
  const [playerCount, setPlayerCount] = useState(4)
  const [definition, setDefinition] = useState<BoardDefinition>(() => cloneDefinition(BOARD_DEFINITIONS[4]))
  const [target, setTarget] = useState<PlacementTarget>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  function selectBoard(count: number) {
    setPlayerCount(count)
    setDefinition(cloneDefinition(BOARD_DEFINITIONS[count]))
    setTarget(null)
  }

  function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!target || !imgRef.current) return
    const rect = imgRef.current.getBoundingClientRect()
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 1000
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 1000

    setDefinition((prev) => {
      const next = cloneDefinition(prev)
      if (target.kind === 'track') {
        next.trackWaypoints.push([x, y])
      } else if (target.kind === 'yard') {
        const lane = next.playerLanes[target.laneIndex]
        if (lane.yardWaypoints.length < 4) lane.yardWaypoints.push([x, y])
      } else if (target.kind === 'corridor') {
        next.playerLanes[target.laneIndex].homeCorridorWaypoints.push([x, y])
      }
      return next
    })
  }

  function updateLane(laneIndex: number, patch: Partial<BoardDefinition['playerLanes'][number]>) {
    setDefinition((prev) => {
      const next = cloneDefinition(prev)
      Object.assign(next.playerLanes[laneIndex], patch)
      return next
    })
  }

  function undoLast() {
    setDefinition((prev) => {
      const next = cloneDefinition(prev)
      if (!target) return next
      if (target.kind === 'track') next.trackWaypoints.pop()
      else if (target.kind === 'yard') next.playerLanes[target.laneIndex].yardWaypoints.pop()
      else if (target.kind === 'corridor') next.playerLanes[target.laneIndex].homeCorridorWaypoints.pop()
      return next
    })
  }

  const json = useMemo(() => JSON.stringify(definition, null, 2), [definition])

  function downloadJson() {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `board_${playerCount}p.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, color: '#eee', fontFamily: 'monospace' }}>
      <div>
        <div style={{ marginBottom: 8 }}>
          Board:{' '}
          {[2, 3, 4, 5, 6].map((n) => (
            <button key={n} onClick={() => selectBoard(n)} disabled={n === playerCount}>
              {n}p
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', width: 640 }}>
          <img
            ref={imgRef}
            src={definition.boardImage}
            alt={`board ${playerCount}p`}
            style={{ width: 640, display: 'block', cursor: target ? 'crosshair' : 'default' }}
            onClick={handleImageClick}
          />
          <svg style={{ position: 'absolute', inset: 0, width: 640, pointerEvents: 'none' }} viewBox="0 0 1 1" preserveAspectRatio="none">
            {definition.trackWaypoints.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={0.006} fill="cyan" />
            ))}
            {definition.playerLanes.map((lane) =>
              [...lane.yardWaypoints, ...lane.homeCorridorWaypoints].map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={0.006} fill={getColor(lane.color)} />
              )),
            )}
          </svg>
        </div>
      </div>

      <div style={{ width: 360 }}>
        <div style={{ marginBottom: 8 }}>
          <button onClick={() => setTarget(target?.kind === 'track' ? null : { kind: 'track' })}>
            {target?.kind === 'track' ? 'Stop placing track' : `Place track (${definition.trackWaypoints.length})`}
          </button>{' '}
          <button onClick={undoLast} disabled={!target}>Undo last</button>
        </div>

        {definition.playerLanes.map((lane, i) => (
          <div key={lane.color} style={{ marginBottom: 8, borderLeft: `4px solid ${getColor(lane.color)}`, paddingLeft: 8 }}>
            <strong>{lane.color}</strong>
            <div>
              <button onClick={() => setTarget(target?.kind === 'yard' && target.laneIndex === i ? null : { kind: 'yard', laneIndex: i })}>
                Yard ({lane.yardWaypoints.length}/4)
              </button>{' '}
              <button onClick={() => setTarget(target?.kind === 'corridor' && target.laneIndex === i ? null : { kind: 'corridor', laneIndex: i })}>
                Corridor ({lane.homeCorridorWaypoints.length})
              </button>
            </div>
            <label>
              entry idx{' '}
              <input
                type="number"
                value={lane.entryTrackIndex}
                onChange={(e) => updateLane(i, { entryTrackIndex: Number(e.target.value) })}
                style={{ width: 50 }}
              />
            </label>{' '}
            <label>
              home-entrance idx{' '}
              <input
                type="number"
                value={lane.homeEntranceTrackIndex}
                onChange={(e) => updateLane(i, { homeEntranceTrackIndex: Number(e.target.value) })}
                style={{ width: 50 }}
              />
            </label>
          </div>
        ))}

        <label>
          Safe indices (comma separated){' '}
          <input
            type="text"
            defaultValue={definition.safeTrackIndices.join(',')}
            onBlur={(e) =>
              setDefinition((prev) => ({
                ...cloneDefinition(prev),
                safeTrackIndices: e.target.value
                  .split(',')
                  .map((s) => Number(s.trim()))
                  .filter((n) => !Number.isNaN(n)),
              }))
            }
            style={{ width: '100%' }}
          />
        </label>

        <div style={{ marginTop: 12 }}>
          <button onClick={downloadJson}>Download board_{playerCount}p.json</button>
        </div>
        <textarea readOnly value={json} style={{ width: '100%', height: 300, marginTop: 8 }} />
      </div>
    </div>
  )
}
