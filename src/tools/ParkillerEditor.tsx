import { Suspense, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { getColor } from '../core/colorPalette'
import { PIECE_COLORS, type PieceColor } from '../core/pieceColor'
import { DEFAULT_PARKILLER_CONFIG, ParkillerModel, type ParkillerArmConfig, type ParkillerGeometryConfig } from '../scene/ParkillerMesh'

// Dev-only tool (see App.tsx, reached via #parkiller-editor). Rebuilt twice now:
//
// v1 (raw coordinates): required understanding x/y/z fields, rotation vectors in radians, and a
// click-to-trace-points-on-a-photo workflow that could silently break the shape. Reported directly
// as too complicated to use at all.
//
// v2 (uniform sliders): body/hood width and waist as single multipliers on the whole existing
// curve. Simple, but reported directly right after ("굴곡이있는 형태를 구축할수없다... 오직 구모양
// 원뿔모양... 대칭적인 모양들만" - can't build curved/undulating shapes, only sphere/cone-like
// uniform shapes) - a fair complaint: a uniform multiplier can make the whole curve bigger or
// smaller, but can't add a waist, move where it flares, or change its proportions at all, since it
// never touches the individual profile points that actually define the curve's shape.
//
// v3 (this one): the body/hood profile points themselves are now directly draggable, in a plain
// visual side-view diagram - grab a dot, drag it in or out, the live 3D model updates immediately.
// No numbers, no coordinates, no "add point" mode to toggle - the existing shape's own points are
// just always there and always draggable. This gives back real curve control (any point can move
// independently of the others) while staying a pure drag interaction.
//
// One real, structural limit this can't lift: the body and hood are built with THREE.LatheGeometry
// (a profile curve spun around the vertical axis - see ParkillerModel in ParkillerMesh.tsx), so
// they are always radially symmetric by construction - there's no such thing as a "left side" and
// "right side" that differ, only one curve mirrored all the way around. The reference photos'
// robe/hood are themselves a symmetric shape from every angle, so this hasn't been a real
// limitation for those two parts - only the arms (already separate, independently positioned
// capsule meshes, one per side) are ever asymmetric, and those remain separately adjustable below.
// Genuinely sculpting an asymmetric body/hood (a lopsided fold, a torn edge, etc.) would need a
// fundamentally different mesh - not a slider or a drag handle, a real hand-modeled or sculpted
// asset - which is a different, much larger undertaking than tuning this existing shape.
const round = (n: number, places = 4): number => {
  const f = 10 ** places
  return Math.round(n * f) / f
}

const MODEL_TOP_Y = 2.9 // hood tip - must match ParkillerMesh.tsx's own constant
const MAX_RADIUS = 0.85

interface ArmParams {
  handDistance: number
  handSize: number
  armLength: number
  overallSize: number
}

const DEFAULT_ARM_PARAMS: ArmParams = { handDistance: 1, handSize: 1, armLength: 1, overallSize: 1 }

function scaleArm(arm: ParkillerArmConfig, sign: 1 | -1, params: ArmParams): ParkillerArmConfig {
  return {
    arm: { ...arm.arm, scale: [arm.arm.scale[0], round(arm.arm.scale[1] * params.armLength), arm.arm.scale[2]] },
    hand: {
      position: [round(sign * Math.abs(arm.hand.position[0]) * params.handDistance), arm.hand.position[1], arm.hand.position[2]],
      scale: arm.hand.scale.map((s) => round(s * params.handSize)) as [number, number, number],
    },
  }
}

function buildConfig(bodyProfile: [number, number][], hoodProfile: [number, number][], armParams: ArmParams): ParkillerGeometryConfig {
  const base = DEFAULT_PARKILLER_CONFIG
  return {
    bodyProfile,
    hoodProfile,
    cavity: base.cavity,
    face: base.face,
    arms: [scaleArm(base.arms[0], 1, armParams), scaleArm(base.arms[1], -1, armParams)],
    fold: base.fold,
    modelScale: round(base.modelScale * armParams.overallSize, 6),
  }
}

// One draggable dot per profile point (except the [0,y] anchors that close the lathe's flat
// top/bottom - those must stay exactly on the center axis or the mesh won't close). Dragging
// horizontally changes only that point's own radius; height stays fixed, matching how every point
// in the baseline shape is already laid out - this is deliberately 1D (in/out), not a full 2D
// drag, so points can't accidentally cross above/below their neighbors and scramble the curve.
function ProfilePoint({
  cx,
  cy,
  color,
  onDrag,
}: {
  cx: number
  cy: number
  color: string
  onDrag: (localX: number) => void
}) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={7}
      fill={color}
      stroke="#fff"
      strokeWidth={1.5}
      style={{ cursor: 'ew-resize', touchAction: 'none' }}
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={(e) => {
        if (e.buttons !== 1) return
        const svg = e.currentTarget.ownerSVGElement
        if (!svg) return
        const rect = svg.getBoundingClientRect()
        onDrag(((e.clientX - rect.left) / rect.width) * PROFILE_VIEWBOX_W)
      }}
    />
  )
}

const PROFILE_VIEWBOX_W = 260
const PROFILE_VIEWBOX_H = 460
const PROFILE_CENTER_X = PROFILE_VIEWBOX_W / 2
const PROFILE_MARGIN = 14

function yToSvg(y: number): number {
  return PROFILE_VIEWBOX_H - PROFILE_MARGIN - (y / MODEL_TOP_Y) * (PROFILE_VIEWBOX_H - PROFILE_MARGIN * 2)
}
function radiusToSvgHalfWidth(r: number): number {
  return (r / MAX_RADIUS) * (PROFILE_CENTER_X - PROFILE_MARGIN)
}
function svgOffsetToRadius(offsetFromCenter: number): number {
  const clamped = Math.max(0, Math.min(PROFILE_CENTER_X - PROFILE_MARGIN, offsetFromCenter))
  return round((clamped / (PROFILE_CENTER_X - PROFILE_MARGIN)) * MAX_RADIUS)
}

function ProfileEditor({
  bodyProfile,
  hoodProfile,
  onBodyChange,
  onHoodChange,
}: {
  bodyProfile: [number, number][]
  hoodProfile: [number, number][]
  onBodyChange: (next: [number, number][]) => void
  onHoodChange: (next: [number, number][]) => void
}) {
  const toPath = (points: [number, number][], side: 1 | -1) =>
    points.map(([r, y]) => `${PROFILE_CENTER_X + side * radiusToSvgHalfWidth(r)},${yToSvg(y)}`).join(' ')

  return (
    <svg width={PROFILE_VIEWBOX_W} height={PROFILE_VIEWBOX_H} style={{ background: '#0c0c0c', borderRadius: 10, display: 'block' }}>
      <line x1={PROFILE_CENTER_X} y1={0} x2={PROFILE_CENTER_X} y2={PROFILE_VIEWBOX_H} stroke="#333" strokeWidth={1} strokeDasharray="4 4" />
      <polyline points={toPath(bodyProfile, 1)} fill="none" stroke="#c9a24b" strokeWidth={2} />
      <polyline points={toPath(bodyProfile, -1)} fill="none" stroke="#c9a24b" strokeWidth={2} />
      <polyline points={toPath(hoodProfile, 1)} fill="none" stroke="#7ed88b" strokeWidth={2} />
      <polyline points={toPath(hoodProfile, -1)} fill="none" stroke="#7ed88b" strokeWidth={2} />
      {bodyProfile.map(([r, y], i) =>
        r === 0
          ? null
          : ([1, -1] as const).map((side) => (
              <ProfilePoint
                key={`b${i}-${side}`}
                cx={PROFILE_CENTER_X + side * radiusToSvgHalfWidth(r)}
                cy={yToSvg(y)}
                color="#c9a24b"
                onDrag={(localX) => {
                  const next = [...bodyProfile]
                  next[i] = [svgOffsetToRadius(side * (localX - PROFILE_CENTER_X)), y]
                  onBodyChange(next)
                }}
              />
            )),
      )}
      {hoodProfile.map(([r, y], i) =>
        r === 0
          ? null
          : ([1, -1] as const).map((side) => (
              <ProfilePoint
                key={`h${i}-${side}`}
                cx={PROFILE_CENTER_X + side * radiusToSvgHalfWidth(r)}
                cy={yToSvg(y)}
                color="#7ed88b"
                onDrag={(localX) => {
                  const next = [...hoodProfile]
                  next[i] = [svgOffsetToRadius(side * (localX - PROFILE_CENTER_X)), y]
                  onHoodChange(next)
                }}
              />
            )),
      )}
    </svg>
  )
}

type View = 'angle' | 'back' | 'side' | 'front' | 'full'

const VIEW_IMAGES: Record<View, string> = {
  angle: '/reference/parkiller-angle.png',
  back: '/reference/parkiller-back.png',
  side: '/reference/parkiller-side.png',
  front: '/reference/parkiller-front.png',
  full: '/reference/parkiller-full.png',
}

const VIEW_LABELS: Record<View, string> = {
  angle: 'Ángulo 3/4',
  back: 'Espalda',
  side: 'Costado',
  front: 'Frente',
  full: 'Hoja completa',
}

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.01,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#eee' }}>{label}</span>
        <span style={{ fontSize: 14, color: '#7ed88b', fontVariantNumeric: 'tabular-nums' }}>{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', height: 28, cursor: 'pointer' }}
      />
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1, color: '#c9a24b', marginTop: 22, marginBottom: 10, textTransform: 'uppercase' }}>
      {children}
    </div>
  )
}

export default function ParkillerEditor() {
  const [view, setView] = useState<View>('angle')
  const [color, setColor] = useState<PieceColor>('Red')
  const [bodyProfile, setBodyProfile] = useState<[number, number][]>(DEFAULT_PARKILLER_CONFIG.bodyProfile)
  const [hoodProfile, setHoodProfile] = useState<[number, number][]>(DEFAULT_PARKILLER_CONFIG.hoodProfile)
  const [armParams, setArmParams] = useState<ArmParams>(DEFAULT_ARM_PARAMS)

  const config = useMemo(() => buildConfig(bodyProfile, hoodProfile, armParams), [bodyProfile, hoodProfile, armParams])
  const setArm = <K extends keyof ArmParams>(key: K) => (value: number) => setArmParams((p) => ({ ...p, [key]: value }))

  function resetAll() {
    setBodyProfile(DEFAULT_PARKILLER_CONFIG.bodyProfile)
    setHoodProfile(DEFAULT_PARKILLER_CONFIG.hoodProfile)
    setArmParams(DEFAULT_ARM_PARAMS)
  }

  return (
    <div style={{ display: 'flex', gap: 20, padding: 20, color: '#eee', fontFamily: 'system-ui, sans-serif', background: '#161616', minHeight: '100vh', flexWrap: 'wrap' }}>
      {/* Reference photos - view only */}
      <div style={{ flexShrink: 0, width: 340 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 12px 0' }}>Editor de forma del Parki</h1>
        <p style={{ fontSize: 13, color: '#aaa', lineHeight: 1.6, marginBottom: 14 }}>
          Los puntos <b style={{ color: '#c9a24b' }}>dorados</b> (cuerpo) y <b style={{ color: '#7ed88b' }}>verdes</b> (capucha) del panel del medio se
          arrastran hacia adentro o hacia afuera con el mouse. La figura 3D y este mismo dibujo se actualizan al instante. Compará con estas fotos, y
          cuando quede parecida sacale una captura de pantalla a toda la página.
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {(Object.keys(VIEW_IMAGES) as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              disabled={v === view}
              style={{
                padding: '8px 12px',
                fontSize: 13,
                fontWeight: v === view ? 700 : 400,
                background: v === view ? '#3a3a3a' : '#242424',
                color: '#eee',
                border: '1px solid #555',
                borderRadius: 6,
                cursor: v === view ? 'default' : 'pointer',
              }}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
        <img src={VIEW_IMAGES[view]} alt={`referencia - ${VIEW_LABELS[view]}`} style={{ width: 340, borderRadius: 8, display: 'block' }} />
      </div>

      {/* Draggable profile silhouette */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ marginBottom: 10, fontSize: 13, color: '#999' }}>Arrastrá los puntos ← →</div>
        <ProfileEditor bodyProfile={bodyProfile} hoodProfile={hoodProfile} onBodyChange={setBodyProfile} onHoodChange={setHoodProfile} />
      </div>

      {/* Live 3D preview */}
      <div style={{ width: 360, flexShrink: 0 }}>
        <div style={{ marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PIECE_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              title={c}
              style={{ width: 26, height: 26, borderRadius: 6, background: getColor(c), border: color === c ? '2px solid white' : '1px solid #666', cursor: 'pointer' }}
            />
          ))}
        </div>
        <div style={{ width: 360, height: 460, background: '#0c0c0c', borderRadius: 10 }}>
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
        <p style={{ fontSize: 12, color: '#999', marginTop: 8 }}>Arrastrá con el mouse (fuera de los puntos) para girar la figura.</p>
      </div>

      {/* Arms/hands + reset */}
      <div style={{ width: 300, flexShrink: 0 }}>
        <button
          onClick={resetAll}
          style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, background: '#5a1e1e', color: '#fff', border: '1px solid #a33', borderRadius: 6, cursor: 'pointer' }}
        >
          ↩️ Volver a la forma actual
        </button>

        <SectionTitle>Tamaño</SectionTitle>
        <Slider label="Tamaño general de la figura" value={armParams.overallSize} onChange={setArm('overallSize')} min={0.8} max={1.3} />

        <SectionTitle>Brazos y manos</SectionTitle>
        <Slider label="Distancia de las manos al cuerpo" value={armParams.handDistance} onChange={setArm('handDistance')} min={0.85} max={1.35} />
        <Slider label="Tamaño de las manos" value={armParams.handSize} onChange={setArm('handSize')} min={0.7} max={1.6} />
        <Slider label="Largo de los brazos" value={armParams.armLength} onChange={setArm('armLength')} min={0.7} max={1.3} />

        <p style={{ fontSize: 12, color: '#888', lineHeight: 1.6, marginTop: 20 }}>
          El cuerpo y la capucha siempre quedan simétricos (iguales de los dos lados) - así está construida la figura en 3D, igual que la figura de
          referencia. Sólo los brazos pueden ser distintos de cada lado, y esos se ajustan con los controles de arriba.
        </p>
      </div>
    </div>
  )
}
