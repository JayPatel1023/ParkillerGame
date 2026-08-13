import { useEffect, useRef } from 'react'
import type { RewardGrant, RewardReason } from '../core/gameFlow/turnManager'

// A capture/finish reward used to be a single small text line tucked into the corner HUD panel -
// reported directly as feeling too serious/stiff for what should be an exciting moment ("사람들이
// 스트레스를 풀수있게... 재미난 감이 들게"). This is a proper celebratory pop-in toast instead:
// bounces in center-stage, holds briefly, fades out - the kind of "+20!" moment other games give a
// capture, not a status line you might not even notice.

function rewardLabel(reason: RewardReason): string {
  return reason === 'capture' ? '¡Captura!' : '¡Meta!'
}

export function RewardToast({ pendingReward, forfeitedReward }: { pendingReward: RewardGrant | null; forfeitedReward: RewardGrant | null }) {
  // A fresh key per new grant remounts the toast, restarting its CSS animation even when two
  // captures in a row happen to share the same amount/reason (same object shape, different event).
  const toastKeyRef = useRef(0)
  const shown = pendingReward ?? forfeitedReward
  const isForfeited = !pendingReward && forfeitedReward !== null

  useEffect(() => {
    if (shown) toastKeyRef.current++
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingReward, forfeitedReward])

  if (!shown) return null

  return (
    <div key={toastKeyRef.current} style={wrapperStyle}>
      <div style={isForfeited ? forfeitedCardStyle : cardStyle} className="reward-toast-pop">
        <div style={amountStyle}>{isForfeited ? 'Perdida' : `+${shown.amount}`}</div>
        <div style={labelStyle}>{isForfeited ? `Recompensa de ${shown.amount} sin ficha disponible` : rewardLabel(shown.reason)}</div>
      </div>
      <style>{`
        @keyframes reward-toast-pop {
          0% { transform: scale(0.4) translateY(14px); opacity: 0; }
          55% { transform: scale(1.08) translateY(-4px); opacity: 1; }
          75% { transform: scale(0.97) translateY(0); }
          100% { transform: scale(1) translateY(0); }
        }
        .reward-toast-pop { animation: reward-toast-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
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

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  padding: '14px 32px',
  borderRadius: 20,
  background: 'linear-gradient(155deg, #ffe08a 0%, #ccb154 55%, #a9873a 100%)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.35), 0 0 0 2px rgba(255,255,255,0.35) inset',
  fontFamily: 'system-ui, sans-serif',
}

const forfeitedCardStyle: React.CSSProperties = {
  ...cardStyle,
  background: 'linear-gradient(155deg, #8a7a6a 0%, #5c5248 55%, #43392f 100%)',
}

const amountStyle: React.CSSProperties = {
  fontSize: 34,
  fontWeight: 800,
  color: '#2a2210',
  textShadow: '0 1px 0 rgba(255,255,255,0.4)',
  lineHeight: 1,
}

const labelStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#2a2210',
  opacity: 0.85,
}
