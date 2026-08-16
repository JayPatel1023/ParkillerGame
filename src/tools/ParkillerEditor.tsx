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
// silhouette directly against Carlos's reference photo, with a live 3D preview right next to it -
// the same fix the board waypoints got once a hand-guessed smooth-curve approximation stopped
// being good enough (see WaypointEditor.tsx). Several rounds of screenshot-then-reason iteration
// on the body/hood profile all still read as "not matching" - this tool exists because that loop
// has a hard ceiling: the model never gets to see the 3D result and the reference photo in the
// same place at the same time, only a person looking at a screen can.
//
// First version required the person using it to manually calibrate ground/tip/center against the
// photo before clicking anything, in pure fraction units with no sanity checking - a small
// calibration mistake (ground and tip landing close together) silently blew up every downstream
// radius/height into the thousands, producing garbage with no visible warning (reported directly,
// with a screenshot of the resulting shape - a flying-saucer blob, not a figure). This version
// bakes in the correct calibration for the one view that's actually meant for tracing (back -
// measured directly against public/reference/parkiller-back.png's own red-figure pixel bounding
// box, not guessed), so there's nothing left to miscalibrate, and adds a full reset alongside the
// existing single-point undo.

type View = 'back' | 'side' | 'front' | 'full'

const VIEW_IMAGES: Record<View, string> = {
  back: '/reference/parkiller-back.png',
  side: '/reference/parkiller-side.png',
  front: '/reference/parkiller-front.png',
  full: '/reference/parkiller-full.png',
}

// Measured directly against public/reference/parkiller-back.png (360x806): the figure's own red
// pixel bounding box top/bottom, and the horizontal midpoint of its top few rows (the hood tip) as
// the center axis - NOT the image's own horizontal center, which sits noticeably right of the
// figure's true axis in this particular crop. Only meaningful for the "back" view; the other three
// views use different crop offsets and aren't set up for point-tracing (see PointMode below).
const BACK_VIEW_CALIBRATION = { groundY: 0.945, tipY: 0.124, centerX: 0.341 }

type PointMode = 'body' | 'hood' | null

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
  const [mode, setMode] = useState<PointMode>(null)
  const [color, setColor] = useState<PieceColor>('Red')

  const [bodyProfile, setBodyProfile] = useState<[number, number][]>(DEFAULT_PARKILLER_CONFIG.bodyProfile)
  const [hoodProfile, setHoodProfile] = useState<[number, number][]>(DEFAULT_PARKILLER_CONFIG.hoodProfile)
  const [cavity, setCavity] = useState(DEFAULT_PARKILLER_CONFIG.cavity)
  const [face, setFace] = useState(DEFAULT_PARKILLER_CONFIG.face)
  const [arms, setArms] = useState(DEFAULT_PARKILLER_CONFIG.arms)
  const [fold, setFold] = useState(DEFAULT_PARKILLER_CONFIG.fold)

  const imgRef = useRef<HTMLImageElement>(null)
  const { groundY, tipY, centerX } = BACK_VIEW_CALIBRATION
  const canTrace = view === 'back'

  const config: ParkillerGeometryConfig = useMemo(
    () => ({ bodyProfile, hoodProfile, cavity, face, arms, fold, modelScale: DEFAULT_PARKILLER_CONFIG.modelScale }),
    [bodyProfile, hoodProfile, cavity, face, arms, fold],
  )

  const MODEL_RAW_HEIGHT = 2.9 // must match ParkillerMesh.tsx's own constant - hood tip sits here

  function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!mode || !canTrace || !imgRef.current) return
    const rect = imgRef.current.getBoundingClientRect()
    const nx = (e.clientX - rect.left) / rect.width
    const ny = (e.clientY - rect.top) / rect.height

    // Pixel-space conversion, not fraction-space: fraction-of-width and fraction-of-height only
    // match physical scale when multiplied back through the SAME rendered pixel dimensions, since
    // radius (an x-distance) and height (a y-distance) must share one physical scale (pixels are
    // square) even though the image's width and height in CSS pixels differ.
    const groundPx = groundY * rect.height
    const tipPx = tipY * rect.height
    const centerPx = centerX * rect.width
    const pxPerRawUnit = (groundPx - tipPx) / MODEL_RAW_HEIGHT

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
    <div style={{ display: 'flex', gap: 16, padding: 16, color: '#eee', fontFamily: 'system-ui, sans-serif', background: '#161616', minHeight: '100vh' }}>
      {/* Reference photo panel */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ marginBottom: 10, display: 'flex', gap: 8 }}>
          {([
            ['back', '뒷모습 (여기서 점 찍기)'],
            ['side', '옆모습 (참고용)'],
            ['front', '앞모습 (참고용)'],
            ['full', '전체 시트 (참고용)'],
          ] as [View, string][]).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              disabled={v === view}
              style={{ padding: '8px 12px', fontSize: 13, fontWeight: v === view ? 700 : 400, background: v === view ? '#3a3a3a' : '#242424', color: '#eee', border: '1px solid #555', borderRadius: 6 }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Always-visible instruction banner - the single biggest thing missing before: the mode
            was only shown as a subtle button color change, easy to miss entirely. */}
        <div
          style={{
            marginBottom: 10,
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 700,
            background: mode ? '#5a3a10' : '#2a2a2a',
            border: `2px solid ${mode ? '#e0a030' : '#444'}`,
          }}
        >
          {!canTrace && '⚠️ 이 사진에서는 점을 찍을 수 없어요 - "뒷모습" 탭으로 이동하세요.'}
          {canTrace && mode === 'body' && '👉 지금: 몸통 실루엣을 따라 클릭하세요 (오른쪽 가장자리를 위→아래로)'}
          {canTrace && mode === 'hood' && '👉 지금: 후드 실루엣을 따라 클릭하세요'}
          {canTrace && !mode && '아래 버튼을 눌러서 "몸통 점 찍기" 또는 "후드 점 찍기"를 먼저 켜세요.'}
        </div>

        <div style={{ marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => setMode(mode === 'body' ? null : 'body')}
            disabled={!canTrace}
            style={{ padding: '10px 16px', fontSize: 14, fontWeight: 700, background: mode === 'body' ? '#c97b1f' : '#2e2e2e', color: '#fff', border: '1px solid #666', borderRadius: 6 }}
          >
            몸통 점 찍기 ({bodyProfile.length}개)
          </button>
          <button onClick={() => setBodyProfile((p) => p.slice(0, -1))} style={{ padding: '10px 14px', fontSize: 13 }}>
            방금 점 취소
          </button>
          <button
            onClick={() => setMode(mode === 'hood' ? null : 'hood')}
            disabled={!canTrace}
            style={{ padding: '10px 16px', fontSize: 14, fontWeight: 700, background: mode === 'hood' ? '#c97b1f' : '#2e2e2e', color: '#fff', border: '1px solid #666', borderRadius: 6 }}
          >
            후드 점 찍기 ({hoodProfile.length}개)
          </button>
          <button onClick={() => setHoodProfile((p) => p.slice(0, -1))} style={{ padding: '10px 14px', fontSize: 13 }}>
            방금 점 취소
          </button>
        </div>

        <div style={{ marginBottom: 10, display: 'flex', gap: 8 }}>
          <button
            onClick={() => {
              setBodyProfile([])
              setHoodProfile([])
              setMode(null)
            }}
            style={{ padding: '10px 14px', fontSize: 13, background: '#5a1e1e', color: '#fff', border: '1px solid #a33', borderRadius: 6 }}
          >
            🗑️ 전체 점 지우고 처음부터
          </button>
          <button
            onClick={() => {
              setBodyProfile(DEFAULT_PARKILLER_CONFIG.bodyProfile)
              setHoodProfile(DEFAULT_PARKILLER_CONFIG.hoodProfile)
              setMode(null)
            }}
            style={{ padding: '10px 14px', fontSize: 13, background: '#1e3a5a', color: '#fff', border: '1px solid #369', borderRadius: 6 }}
          >
            ↩️ 지금 게임에 있는 모양으로 되돌리기
          </button>
        </div>

        <div style={{ position: 'relative', width: 380 }}>
          <img
            ref={imgRef}
            src={VIEW_IMAGES[view]}
            alt={`parkiller reference - ${view}`}
            style={{ width: 380, display: 'block', cursor: mode && canTrace ? 'crosshair' : 'default', opacity: canTrace ? 1 : 0.85 }}
            onClick={handleImageClick}
          />
          {canTrace && (
            <svg style={{ position: 'absolute', inset: 0, width: 380, pointerEvents: 'none' }} viewBox="0 0 1 1" preserveAspectRatio="none">
              <line x1={0} y1={groundY} x2={1} y2={groundY} stroke="lime" strokeWidth={0.0015} />
              <line x1={0} y1={tipY} x2={1} y2={tipY} stroke="cyan" strokeWidth={0.0015} />
              <line x1={centerX} y1={0} x2={centerX} y2={1} stroke="yellow" strokeWidth={0.0015} />
              {/* The viewBox stretches x and y independently to fill the (non-square) image, so a
                  point's x-fraction and y-fraction need separate pixel-scale conversions - reusing
                  one scale factor for both, as an earlier version of this did, silently misplaced
                  every dot since the image is roughly twice as tall as it is wide. */}
              {[...bodyProfile.map((p) => ['b', p] as const), ...hoodProfile.map((p) => ['h', p] as const)].map(([kind, [r, h]], i) => {
                const rect = imgRef.current?.getBoundingClientRect()
                if (!rect) return null
                const pxPerRawUnit = ((groundY - tipY) * rect.height) / MODEL_RAW_HEIGHT
                const x = centerX + (r * pxPerRawUnit) / rect.width
                const y = groundY - (h * pxPerRawUnit) / rect.height
                return <circle key={`${kind}${i}`} cx={x} cy={y} r={0.006} fill={kind === 'b' ? 'orange' : 'magenta'} />
              })}
            </svg>
          )}
        </div>
        <p style={{ fontSize: 12, color: '#999', width: 380, lineHeight: 1.5 }}>
          초록/청록/노랑 선은 이미 정확하게 맞춰져 있어요 - 다시 설정할 필요 없습니다. "몸통 점 찍기"를 누르고 실루엣 가장자리를 따라
          여러 번 클릭하면, 오른쪽 3D 미리보기가 바로바로 바뀌는 걸 보실 수 있어요. 후드는 "후드 점 찍기"로 같은 방식으로 하시면 됩니다.
          팔은 클릭이 아니라 맨 오른쪽 숫자칸으로 조정하세요 ("옆모습"/"앞모습" 탭 보면서).
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
        <p style={{ fontSize: 12, color: '#999' }}>드래그해서 돌려보면서, 여러 각도에서 사진이랑 비교해보세요 (한 각도만 보지 마시고).</p>
      </div>

      {/* Numeric controls + export */}
      <div style={{ width: 300, flexShrink: 0, maxHeight: '100vh', overflowY: 'auto' }}>
        <SphereConfigEditor title="Face cavity (dark)" config={cavity} onChange={setCavity} />
        <SphereConfigEditor title="Face (light)" config={face} onChange={setFace} />
        <ArmConfigEditor title="Arm 1" config={arms[0]} onChange={(a) => setArms([a, arms[1]])} />
        <ArmConfigEditor title="Arm 2" config={arms[1]} onChange={(a) => setArms([arms[0], a])} />
        <SphereConfigEditor title="Front cloth fold" config={fold} onChange={setFold} />

        <div style={{ marginTop: 12, marginBottom: 6 }}>
          <button
            onClick={() => navigator.clipboard.writeText(json)}
            style={{ padding: '10px 16px', fontSize: 14, fontWeight: 700, background: '#2a6b3a', color: '#fff', border: '1px solid #4a9', borderRadius: 6 }}
          >
            📋 완성됐으면 여기 눌러서 복사 → 저한테 붙여넣기
          </button>
        </div>
        <textarea readOnly value={json} style={{ width: '100%', height: 320, fontSize: 10, fontFamily: 'monospace' }} />
      </div>
    </div>
  )
}
