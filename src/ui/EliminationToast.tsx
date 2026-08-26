import { useEffect, useMemo, useRef } from 'react'
import type { Piece } from '../core/pieces/piece'
import { getColor } from '../core/colorPalette'

// PC2.3's third-consecutive-double penalty used to be a single small line buried in the corner HUD
// ("Tercer dobles seguido: X pierde una ficha") - reported directly, referencing the original
// GameMaker app's own celebratory win screen as the bar to match ("이렇게 멋진알림도 더 추가해주면
// 좋겠다" - add more notifications this cool): a piece silently teleporting back to its yard with
// no on-screen event at all read as the game just doing something inexplicable, not as a named rule
// actually firing. Reuses RewardToast/RewardBurst's own established "pop-in card + radial burst"
// technique (same CSS-particle approach, not a second Three.js system) but in a distinct, cooler
// penalty palette (smoky grey/red) instead of the reward toast's gold - this is a piece coming HOME
// off a bad roll, not a prize, and should read that way at a glance.
const PENALTY_COLORS = ['#c94a4a', '#8f8f8f', '#5c5c5c', '#e0e0e0']
const SPARK_COUNT = 16

interface Spark {
  angle: number
  distance: number
  delay: number
  size: number
  color: string
}

function useSparks(seed: number): Spark[] {
  return useMemo(
    () =>
      Array.from({ length: SPARK_COUNT }, (_, i) => ({
        angle: (360 / SPARK_COUNT) * i + (Math.random() - 0.5) * 14,
        distance: 60 + Math.random() * 40,
        delay: Math.random() * 0.05,
        size: 4 + Math.random() * 4,
        color: PENALTY_COLORS[Math.floor(Math.random() * PENALTY_COLORS.length)],
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seed],
  )
}

export function EliminationToast({ eliminatedPiece }: { eliminatedPiece: Piece | null }) {
  // Same remount-per-event pattern as RewardToast/RewardBurst's own key refs - a fresh key per new
  // elimination restarts the pop-in/burst animations even if the same color loses a piece twice in
  // a row.
  const keyRef = useRef(0)
  useEffect(() => {
    if (eliminatedPiece) keyRef.current++
  }, [eliminatedPiece])

  const sparks = useSparks(keyRef.current)

  if (!eliminatedPiece) return null
  const color = getColor(eliminatedPiece.color)

  return (
    <div key={keyRef.current} style={wrapperStyle}>
      <div style={burstWrapperStyle}>
        <div style={ringStyle} />
        {sparks.map((s, i) => (
          <span
            key={i}
            style={
              {
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: s.size,
                height: s.size,
                borderRadius: '50%',
                background: s.color,
                boxShadow: `0 0 6px ${s.color}`,
                '--angle': `${s.angle}deg`,
                '--distance': `${s.distance}px`,
                animation: `elimination-spark 0.6s ease-out ${s.delay}s both`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <div style={cardStyle} className="elimination-toast-pop">
        <div style={{ ...iconStyle, borderColor: color }}>🏠</div>
        <div style={titleStyle}>¡A casa!</div>
        <div style={labelStyle}>
          Tercer dobles seguido: la ficha de <span style={{ color, fontWeight: 700 }}>{eliminatedPiece.color}</span> vuelve al refugio
        </div>
      </div>
      <style>{`
        @keyframes elimination-toast-pop {
          0% { transform: scale(0.4) translateY(-10px); opacity: 0; }
          55% { transform: scale(1.06) translateY(4px); opacity: 1; }
          75% { transform: scale(0.97) translateY(0); }
          100% { transform: scale(1) translateY(0); }
        }
        .elimination-toast-pop { animation: elimination-toast-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
        @keyframes elimination-spark {
          0% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(0) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(var(--distance)) scale(0.3); opacity: 0; }
        }
        @keyframes elimination-ring {
          0% { transform: scale(0.2); opacity: 0.8; border-width: 4px; }
          100% { transform: scale(2.2); opacity: 0; border-width: 1px; }
        }
      `}</style>
    </div>
  )
}

const wrapperStyle: React.CSSProperties = {
  position: 'absolute',
  top: '18%',
  left: '50%',
  transform: 'translateX(-50%)',
  pointerEvents: 'none',
  zIndex: 5,
}

const burstWrapperStyle: React.CSSProperties = {
  position: 'absolute',
  top: 40,
  left: '50%',
  width: 0,
  height: 0,
  zIndex: -1,
}

const ringStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  width: 80,
  height: 80,
  marginTop: -40,
  marginLeft: -40,
  borderRadius: '50%',
  border: '4px solid #c94a4a',
  animation: 'elimination-ring 0.5s ease-out both',
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  padding: '14px 32px',
  borderRadius: 20,
  background: 'linear-gradient(155deg, #6b5a5a 0%, #3a2e2e 55%, #241c1c 100%)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.45), 0 0 0 2px rgba(255,255,255,0.12) inset',
  fontFamily: 'system-ui, sans-serif',
}

const iconStyle: React.CSSProperties = {
  fontSize: 22,
  lineHeight: 1,
  marginBottom: 2,
  width: 34,
  height: 34,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  border: '2px solid',
  background: 'rgba(255,255,255,0.08)',
}

const titleStyle: React.CSSProperties = {
  fontSize: 26,
  fontWeight: 800,
  color: '#f2e9e9',
  textShadow: '0 1px 0 rgba(0,0,0,0.4)',
  lineHeight: 1,
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#e6dcdc',
  opacity: 0.9,
  textAlign: 'center',
  maxWidth: 220,
}
