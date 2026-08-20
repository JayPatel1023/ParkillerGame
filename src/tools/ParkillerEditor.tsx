import { Suspense, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { getColor } from '../core/colorPalette'
import { PIECE_COLORS, type PieceColor } from '../core/pieceColor'
import { DEFAULT_PARKILLER_CONFIG, ParkillerModel, type ParkillerArmConfig, type ParkillerGeometryConfig } from '../scene/ParkillerMesh'

// Dev-only tool (see App.tsx, reached via #parkiller-editor). Rebuilt from scratch, reported
// directly ("현재는 너무복잡하다. 사용법을 모르고 정확하지도않다" - too complicated, don't know how to
// use it, not accurate either): the previous version required understanding raw x/y/z coordinate
// fields, rotation vectors in radians, and a click-to-trace-points-on-a-photo workflow that could
// silently produce a broken shape if points landed in the wrong order. None of that is something a
// non-technical client can be expected to operate.
//
// This version has exactly one interaction: drag a handful of labeled sliders (body width, hood
// width, hand size, etc), each a simple multiplier on the currently-shipped shape, and watch the
// live 3D preview update immediately next to the reference photos. There is no way to produce a
// broken/degenerate shape - every slider is clamped to a sane range and only ever scales the known-
// good baseline, never free-form points. No copy/paste or JSON needed either: the chosen values are
// printed in plain Spanish right on the page, so a plain screenshot of the whole page is a complete,
// readable report of what was changed.
const round = (n: number, places = 4): number => {
  const f = 10 ** places
  return Math.round(n * f) / f
}

interface SimpleParams {
  bodyWidth: number
  waist: number
  hoodWidth: number
  hoodHeight: number
  handDistance: number
  handSize: number
  armLength: number
  overallSize: number
}

const DEFAULT_PARAMS: SimpleParams = {
  bodyWidth: 1,
  waist: 1,
  hoodWidth: 1,
  hoodHeight: 1,
  handDistance: 1,
  handSize: 1,
  armLength: 1,
  overallSize: 1,
}

// Every slider is a pure multiplier applied to the currently-shipped baseline shape
// (DEFAULT_PARKILLER_CONFIG) - never free-form point editing, so there is no way to end up with a
// degenerate/broken lathe profile the way the old click-trace tool could.
function buildConfig(params: SimpleParams): ParkillerGeometryConfig {
  const base = DEFAULT_PARKILLER_CONFIG

  // Body: point 0 is the [0,0] center anchor that closes the lathe's flat bottom disc and must stay
  // exactly on the axis (radius 0) or the base won't close - only points from index 4 up (roughly
  // waist height and above, see BODY_PROFILE_RAW in ParkillerMesh.tsx) get the extra "waist" pinch,
  // so narrowing the waist doesn't also shrink the wide base the robe rests on.
  const bodyProfile: [number, number][] = base.bodyProfile.map(([r, y], i) => {
    if (r === 0) return [0, y]
    const waistFactor = i >= 4 ? params.waist : 1
    return [round(r * params.bodyWidth * waistFactor), y]
  })

  // Hood: widened only up to a conservative cap (see the slider's own max below) - a much wider
  // hood was tried once already (see git history) and reported back as reading like a round
  // "blob" rather than a pointed hood from a head-on angle, so this tool deliberately can't
  // reproduce that mistake.
  const hoodBaseY = base.hoodProfile[0][1]
  const hoodProfile: [number, number][] = base.hoodProfile.map(([r, y]) => [
    round(r * params.hoodWidth),
    round(hoodBaseY + (y - hoodBaseY) * params.hoodHeight),
  ])

  const scaleArm = (arm: ParkillerArmConfig, sign: 1 | -1): ParkillerArmConfig => ({
    arm: { ...arm.arm, scale: [arm.arm.scale[0], round(arm.arm.scale[1] * params.armLength), arm.arm.scale[2]] },
    hand: {
      position: [round(sign * Math.abs(arm.hand.position[0]) * params.handDistance), arm.hand.position[1], arm.hand.position[2]],
      scale: arm.hand.scale.map((s) => round(s * params.handSize)) as [number, number, number],
    },
  })

  return {
    bodyProfile,
    hoodProfile,
    cavity: base.cavity,
    face: base.face,
    arms: [scaleArm(base.arms[0], 1), scaleArm(base.arms[1], -1)],
    fold: base.fold,
    modelScale: round(base.modelScale * params.overallSize, 6),
  }
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
  const [params, setParams] = useState<SimpleParams>(DEFAULT_PARAMS)

  const config = useMemo(() => buildConfig(params), [params])
  const set = <K extends keyof SimpleParams>(key: K) => (value: number) => setParams((p) => ({ ...p, [key]: value }))

  return (
    <div style={{ display: 'flex', gap: 20, padding: 20, color: '#eee', fontFamily: 'system-ui, sans-serif', background: '#161616', minHeight: '100vh' }}>
      {/* Reference photos - view only, no tracing/clicking */}
      <div style={{ flexShrink: 0, width: 360 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 12px 0' }}>Editor de forma del Parki</h1>
        <p style={{ fontSize: 13, color: '#aaa', lineHeight: 1.6, marginBottom: 14 }}>
          Movés cada control (deslizador) de la derecha y mirás cómo cambia la figura en el medio. Compará con estas fotos. Cuando quede parecida,
          sacale una captura de pantalla a toda esta página y enviásela.
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
        <img src={VIEW_IMAGES[view]} alt={`referencia - ${VIEW_LABELS[view]}`} style={{ width: 360, borderRadius: 8, display: 'block' }} />
      </div>

      {/* Live 3D preview */}
      <div style={{ width: 380, flexShrink: 0 }}>
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
        <div style={{ width: 380, height: 480, background: '#0c0c0c', borderRadius: 10 }}>
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
        <p style={{ fontSize: 12, color: '#999', marginTop: 8 }}>Arrastrá con el mouse para girar la figura y verla desde todos los ángulos.</p>
      </div>

      {/* Sliders */}
      <div style={{ width: 320, flexShrink: 0, maxHeight: '100vh', overflowY: 'auto', paddingRight: 8 }}>
        <button
          onClick={() => setParams(DEFAULT_PARAMS)}
          style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, background: '#5a1e1e', color: '#fff', border: '1px solid #a33', borderRadius: 6, cursor: 'pointer' }}
        >
          ↩️ Volver a la forma actual
        </button>

        <SectionTitle>Cuerpo</SectionTitle>
        <Slider label="Ancho del cuerpo" value={params.bodyWidth} onChange={set('bodyWidth')} min={0.7} max={1.3} />
        <Slider label="Cintura (más angosta arriba)" value={params.waist} onChange={set('waist')} min={0.6} max={1.1} />
        <Slider label="Tamaño general de la figura" value={params.overallSize} onChange={set('overallSize')} min={0.8} max={1.3} />

        <SectionTitle>Capucha</SectionTitle>
        <Slider label="Ancho de la capucha" value={params.hoodWidth} onChange={set('hoodWidth')} min={0.75} max={1.2} />
        <Slider label="Altura de la capucha" value={params.hoodHeight} onChange={set('hoodHeight')} min={0.75} max={1.25} />

        <SectionTitle>Brazos y manos</SectionTitle>
        <Slider label="Distancia de las manos al cuerpo" value={params.handDistance} onChange={set('handDistance')} min={0.85} max={1.35} />
        <Slider label="Tamaño de las manos" value={params.handSize} onChange={set('handSize')} min={0.7} max={1.6} />
        <Slider label="Largo de los brazos" value={params.armLength} onChange={set('armLength')} min={0.7} max={1.3} />
      </div>
    </div>
  )
}
