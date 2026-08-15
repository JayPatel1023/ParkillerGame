import { Suspense, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { getColor } from '../core/colorPalette'
import { PIECE_COLORS, type PieceColor } from '../core/pieceColor'
import {
  DEFAULT_PARKILLER_CONFIG,
  ParkillerModel,
  type ParkillerArmConfig,
  type ParkillerGeometryConfig,
  type SphereMeshConfig,
} from '../scene/ParkillerMesh'

// Dev-only tool (see App.tsx, reached via #parkiller-editor): click-trace the Parkiller body/hood
// silhouette directly against Carlos's reference photo (parkiller.png), with a live 3D preview
// right next to it, the same fix the board waypoints got once a hand-guessed smooth-curve
// approximation stopped being good enough (see WaypointEditor.tsx). Several rounds of
// screenshot-then-reason iteration on the body/hood profile and arm placement all still read as
// "not matching" - this tool exists because that loop has a hard ceiling: the model never gets to
// see the 3D result and the reference photo in the same place at the same time, only a person
// looking at a screen can. Copy the exported JSON out when it looks right and it goes straight
// back into ParkillerMesh.tsx's DEFAULT_PARKILLER_CONFIG.

type View = 'back' | 'side' | 'front' | 'full'

const VIEW_IMAGES: Record<View, string> = {
  back: '/reference/parkiller-back.png',
  side: '/reference/parkiller-side.png',
  front: '/reference/parkiller-front.png',
  full: '/reference/parkiller-full.png',
}

type ProfileMode = 'ground' | 'tip' | 'center' | 'body' | 'hood' | null

function round(n: number, places = 3): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}

function Vec3Row({
  label,
  value,
  onChange,
  step = 0.01,
}: {
  label: string
  value: [number, number, number]
  onChange: (next: [number, number, number]) => void
  step?: number
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
      <span style={{ width: 78, fontSize: 11, color: '#aaa', flexShrink: 0 }}>{label}</span>
      {(['x', 'y', 'z'] as const).map((axis, i) => (
        <input
          key={axis}
          type="number"
          step={step}
          value={value[i]}
          onChange={(e) => {
            const next: [number, number, number] = [...value]
            next[i] = Number(e.target.value)
            onChange(next)
          }}
          style={{ width: 58, fontSize: 11 }}
        />
      ))}
    </div>
  )
}

function SphereConfigEditor({
  title,
  config,
  onChange,
}: {
  title: string
  config: SphereMeshConfig
  onChange: (next: SphereMeshConfig) => void
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: '#ccc', marginBottom: 2 }}>{title}</div>
      <Vec3Row label="position" value={config.position} onChange={(position) => onChange({ ...config, position })} />
      <Vec3Row label="scale" value={config.scale} onChange={(scale) => onChange({ ...config, scale })} />
    </div>
  )
}

function ArmConfigEditor({
  title,
  config,
  onChange,
}: {
  title: string
  config: ParkillerArmConfig
  onChange: (next: ParkillerArmConfig) => void
}) {
  return (
    <div style={{ marginBottom: 10, borderLeft: '3px solid #555', paddingLeft: 8 }}>
      <div style={{ fontSize: 12, color: '#ccc', marginBottom: 2 }}>{title}</div>
      <Vec3Row label="arm pos" value={config.arm.position} onChange={(position) => onChange({ ...config, arm: { ...config.arm, position } })} />
      <Vec3Row
        label="arm rot"
        value={config.arm.rotation}
        step={0.05}
        onChange={(rotation) => onChange({ ...config, arm: { ...config.arm, rotation } })}
      />
      <Vec3Row label="arm scale" value={config.arm.scale} onChange={(scale) => onChange({ ...config, arm: { ...config.arm, scale } })} />
      <Vec3Row label="hand pos" value={config.hand.position} onChange={(position) => onChange({ ...config, hand: { ...config.hand, position } })} />
      <Vec3Row label="hand scale" value={config.hand.scale} onChange={(scale) => onChange({ ...config, hand: { ...config.hand, scale } })} />
    </div>
  )
}

export default function ParkillerEditor() {
  const [view, setView] = useState<View>('back')
  const [mode, setMode] = useState<ProfileMode>(null)
  const [color, setColor] = useState<PieceColor>('Red')

  // Calibration, as fractions (0..1) of the displayed reference image - set by clicking the image
  // in 'ground'/'tip'/'center' mode. Defaults are rough guesses; set them for real before tracing
  // body/hood points; every click converts through these three values.
  const [groundY, setGroundY] = useState(0.94)
  const [tipY, setTipY] = useState(0.06)
  const [centerX, setCenterX] = useState(0.5)

  const [bodyProfile, setBodyProfile] = useState<[number, number][]>(DEFAULT_PARKILLER_CONFIG.bodyProfile)
  const [hoodProfile, setHoodProfile] = useState<[number, number][]>(DEFAULT_PARKILLER_CONFIG.hoodProfile)
  const [cavity, setCavity] = useState(DEFAULT_PARKILLER_CONFIG.cavity)
  const [face, setFace] = useState(DEFAULT_PARKILLER_CONFIG.face)
  const [arms, setArms] = useState(DEFAULT_PARKILLER_CONFIG.arms)
  const [fold, setFold] = useState(DEFAULT_PARKILLER_CONFIG.fold)

  const imgRef = useRef<HTMLImageElement>(null)

  const config: ParkillerGeometryConfig = useMemo(
    () => ({ bodyProfile, hoodProfile, cavity, face, arms, fold, modelScale: DEFAULT_PARKILLER_CONFIG.modelScale }),
    [bodyProfile, hoodProfile, cavity, face, arms, fold],
  )

  const MODEL_RAW_HEIGHT = 2.9 // must match ParkillerMesh.tsx's own constant - hood tip sits here

  function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!mode || !imgRef.current) return
    const rect = imgRef.current.getBoundingClientRect()
    const nx = (e.clientX - rect.left) / rect.width
    const ny = (e.clientY - rect.top) / rect.height

    if (mode === 'ground') return setGroundY(ny)
    if (mode === 'tip') return setTipY(ny)
    if (mode === 'center') return setCenterX(nx)

    // Pixel-space conversion, not fraction-space: fraction-of-width and fraction-of-height only
    // match physical scale when multiplied back through the SAME rendered pixel dimensions, since
    // radius (an x-distance) and height (a y-distance) must share one physical scale (pixels are
    // square) even though the image's width and height in CSS pixels differ.
    const groundPx = groundY * rect.height
    const tipPx = tipY * rect.height
    const centerPx = centerX * rect.width
    const pxPerRawUnit = (groundPx - tipPx) / MODEL_RAW_HEIGHT
    if (pxPerRawUnit <= 0) return // ground/tip not calibrated sanely yet

    const clickPx = { x: nx * rect.width, y: ny * rect.height }
    const height = round((groundPx - clickPx.y) / pxPerRawUnit)
    const radius = round(Math.abs(clickPx.x - centerPx) / pxPerRawUnit)

    const point: [number, number] = [radius, height]
    if (mode === 'body') {
      setBodyProfile((prev) => [...prev, point].sort((a, b) => a[1] - b[1]))
    } else if (mode === 'hood') {
      setHoodProfile((prev) => [...prev, point].sort((a, b) => a[1] - b[1]))
    }
  }

  const json = useMemo(() => JSON.stringify(config, null, 2), [config])

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, color: '#eee', fontFamily: 'monospace', background: '#161616', minHeight: '100vh' }}>
      {/* Reference photo panel */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ marginBottom: 8, display: 'flex', gap: 6 }}>
          {(['back', 'side', 'front', 'full'] as View[]).map((v) => (
            <button key={v} onClick={() => setView(v)} disabled={v === view}>
              {v}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={() => setMode(mode === 'ground' ? null : 'ground')} style={{ background: mode === 'ground' ? '#4a7' : undefined }}>
            Set ground ({round(groundY, 2)})
          </button>
          <button onClick={() => setMode(mode === 'tip' ? null : 'tip')} style={{ background: mode === 'tip' ? '#4a7' : undefined }}>
            Set hood tip ({round(tipY, 2)})
          </button>
          <button onClick={() => setMode(mode === 'center' ? null : 'center')} style={{ background: mode === 'center' ? '#4a7' : undefined }}>
            Set center axis ({round(centerX, 2)})
          </button>
        </div>
        <div style={{ marginBottom: 8, display: 'flex', gap: 6 }}>
          <button onClick={() => setMode(mode === 'body' ? null : 'body')} style={{ background: mode === 'body' ? '#a74' : undefined }}>
            Add body point ({bodyProfile.length})
          </button>
          <button onClick={() => setBodyProfile((p) => p.slice(0, -1))}>Undo body</button>
          <button onClick={() => setMode(mode === 'hood' ? null : 'hood')} style={{ background: mode === 'hood' ? '#a74' : undefined }}>
            Add hood point ({hoodProfile.length})
          </button>
          <button onClick={() => setHoodProfile((p) => p.slice(0, -1))}>Undo hood</button>
        </div>

        <div style={{ position: 'relative', width: 380 }}>
          <img
            ref={imgRef}
            src={VIEW_IMAGES[view]}
            alt={`parkiller reference - ${view}`}
            style={{ width: 380, display: 'block', cursor: mode ? 'crosshair' : 'default' }}
            onClick={handleImageClick}
          />
          <svg style={{ position: 'absolute', inset: 0, width: 380, pointerEvents: 'none' }} viewBox="0 0 1 1" preserveAspectRatio="none">
            <line x1={0} y1={groundY} x2={1} y2={groundY} stroke="lime" strokeWidth={0.002} />
            <line x1={0} y1={tipY} x2={1} y2={tipY} stroke="cyan" strokeWidth={0.002} />
            <line x1={centerX} y1={0} x2={centerX} y2={1} stroke="yellow" strokeWidth={0.002} />
            {bodyProfile.map(([r, h], i) => {
              const rect = imgRef.current?.getBoundingClientRect()
              if (!rect) return null
              const pxPerRawUnit = (groundY * rect.height - tipY * rect.height) / MODEL_RAW_HEIGHT
              const x = (centerX * rect.width + r * pxPerRawUnit) / rect.width
              const y = (groundY * rect.height - h * pxPerRawUnit) / rect.height
              return <circle key={`b${i}`} cx={x} cy={y} r={0.007} fill="orange" />
            })}
            {hoodProfile.map(([r, h], i) => {
              const rect = imgRef.current?.getBoundingClientRect()
              if (!rect) return null
              const pxPerRawUnit = (groundY * rect.height - tipY * rect.height) / MODEL_RAW_HEIGHT
              const x = (centerX * rect.width + r * pxPerRawUnit) / rect.width
              const y = (groundY * rect.height - h * pxPerRawUnit) / rect.height
              return <circle key={`h${i}`} cx={x} cy={y} r={0.007} fill="magenta" />
            })}
          </svg>
        </div>
        <p style={{ fontSize: 11, color: '#888', width: 380 }}>
          Workflow: pick a view (back is cleanest for the body/hood silhouette - no face hole, both arms mostly hidden), set the three green/cyan/
          yellow calibration lines first (ground contact, hood tip, center axis), then click along ONE edge of the silhouette in "Add body point" /
          "Add hood point" mode. Each click reads off the opposite edge automatically (radius = distance from the yellow line). Switch to "front" or
          "side" to eyeball arm placement while adjusting the sliders on the right - the arms aren't from click-points, since they're not
          lathe-symmetric.
        </p>
      </div>

      {/* Live 3D preview */}
      <div style={{ width: 340, flexShrink: 0 }}>
        <div style={{ marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PIECE_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              title={c}
              style={{ width: 24, height: 24, borderRadius: 5, background: getColor(c), border: color === c ? '2px solid white' : '1px solid #666' }}
            />
          ))}
        </div>
        <div style={{ width: 340, height: 420, background: '#0c0c0c', borderRadius: 8 }}>
          <Canvas shadows camera={{ position: [0, 1.1, 2.2], fov: 35 }}>
            <ambientLight intensity={1.2} />
            <directionalLight position={[2, 3, 2]} intensity={0.9} castShadow />
            <directionalLight position={[-2, 2, -1]} intensity={0.5} />
            <Suspense fallback={null}>
              <ParkillerModel color={color} config={config} />
            </Suspense>
            <OrbitControls target={[0, 0.7, 0]} />
          </Canvas>
        </div>
        <p style={{ fontSize: 11, color: '#888' }}>Drag to orbit. Compare this silhouette against the photo from several angles, not just one.</p>
      </div>

      {/* Numeric controls + export */}
      <div style={{ width: 300, flexShrink: 0, maxHeight: '100vh', overflowY: 'auto' }}>
        <SphereConfigEditor title="Face cavity (dark)" config={cavity} onChange={setCavity} />
        <SphereConfigEditor title="Face (light)" config={face} onChange={setFace} />
        <ArmConfigEditor title="Arm 1" config={arms[0]} onChange={(a) => setArms([a, arms[1]])} />
        <ArmConfigEditor title="Arm 2" config={arms[1]} onChange={(a) => setArms([arms[0], a])} />
        <SphereConfigEditor title="Front cloth fold" config={fold} onChange={setFold} />

        <div style={{ marginTop: 12, marginBottom: 6 }}>
          <button onClick={() => navigator.clipboard.writeText(json)}>Copy config JSON</button>
        </div>
        <textarea readOnly value={json} style={{ width: '100%', height: 320, fontSize: 10 }} />
      </div>
    </div>
  )
}
