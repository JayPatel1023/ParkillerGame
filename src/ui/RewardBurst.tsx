import { useEffect, useMemo, useRef } from 'react'
import type { RewardGrant } from '../core/gameFlow/turnManager'

// Reported directly ("멋진효과를 넣어달라... 싫증을 느끼지않게" - add a cool effect so players don't
// get bored): a capture or a finish only ever got RewardToast's own text pop-in, no motion beyond
// that - the win screen's own Confetti got a proper celebration and these two, arguably the most
// exciting moments *during* a game (not just at the very end), got nothing extra. A quick radial
// spark burst behind the toast, gone in well under a second so it never blocks the next move,
// reusing Confetti's own "small DOM particles + CSS keyframes" technique rather than a Three.js
// particle system - this overlay already lives outside the Canvas, same as RewardToast.
const CAPTURE_COLORS = ['#ff6a4a', '#ffae42', '#ff3b3b', '#ffd76a']
const FINISH_COLORS = ['#ffe08a', '#ffd24a', '#fff4c2', '#ffb347']
const SPARK_COUNT = 18

interface Spark {
  angle: number
  distance: number
  delay: number
  size: number
  color: string
}

function useSparks(reason: 'capture' | 'finish', seed: number): Spark[] {
  // seed forces a fresh random layout per grant (see toastKeyRef below) without needing a random
  // call outside render, which would break strict-mode double-invoke assumptions - useMemo keyed
  // on the grant identity is enough since a new grant already means a new seed value.
  return useMemo(() => {
    const colors = reason === 'capture' ? CAPTURE_COLORS : FINISH_COLORS
    return Array.from({ length: SPARK_COUNT }, (_, i) => ({
      angle: (360 / SPARK_COUNT) * i + (Math.random() - 0.5) * 14,
      distance: 70 + Math.random() * 50,
      delay: Math.random() * 0.05,
      size: 5 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])
}

function Burst({ reason, seed }: { reason: 'capture' | 'finish'; seed: number }) {
  const sparks = useSparks(reason, seed)
  return (
    <div style={burstWrapperStyle}>
      {/* Expanding ring shockwave - the "impact" half of the effect, distinct from the sparks'
          own "scatter" half so a capture reads as a hit, not just a sparkle. */}
      <div style={{ ...ringStyle, borderColor: reason === 'capture' ? '#ff6a4a' : '#ffd24a' }} />
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
              animation: `reward-spark 0.6s ease-out ${s.delay}s both`,
            } as React.CSSProperties
          }
        />
      ))}
      <style>{`
        @keyframes reward-spark {
          0% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(0) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(var(--distance)) scale(0.3); opacity: 0; }
        }
        @keyframes reward-ring {
          0% { transform: scale(0.2); opacity: 0.8; border-width: 4px; }
          100% { transform: scale(2.6); opacity: 0; border-width: 1px; }
        }
      `}</style>
    </div>
  )
}

export function RewardBurst({ pendingReward }: { pendingReward: RewardGrant | null }) {
  // Only a real, claimed grant is worth celebrating - a forfeited reward (RewardToast's own
  // "Perdida" state) is the opposite of exciting, so it never triggers this.
  //
  // Incrementing this key *during render* (the first version of this component did) reruns on
  // every render where pendingReward is truthy, not just when a new grant actually arrives - since
  // GameBoardScreen re-renders continuously while a reward is pending (piece animations, etc.),
  // that remounted Burst on nearly every frame, permanently resetting its own CSS animation back to
  // its very first, barely-visible instant - confirmed directly via a Playwright capture sequence
  // that never caught the sparks mid-flight despite sampling well within the animation's own
  // duration. A useEffect keyed on the grant itself, the same pattern RewardToast's own
  // toastKeyRef already uses, only fires once per actual new grant.
  const burstKeyRef = useRef(0)
  useEffect(() => {
    if (pendingReward) burstKeyRef.current++
  }, [pendingReward])

  if (!pendingReward) return null
  return <Burst key={burstKeyRef.current} reason={pendingReward.reason} seed={burstKeyRef.current} />
}

// RewardToast's own wrapper anchors at top:18% as its *top edge*, not its center - its card then
// grows downward from there via its own padding/content. Centering this burst on that same raw
// anchor point (translate(-50%,-50%), no offset) put the sparks visibly above the card instead of
// radiating from it - confirmed directly via a Playwright capture mid-animation. +40px roughly
// matches the toast card's own visual center (~81px total content height / 2).
const burstWrapperStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(18% + 40px)',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 0,
  height: 0,
  pointerEvents: 'none',
  zIndex: 4, // just behind RewardToast's own z-index (5), so the sparks read as coming from it
}

const ringStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  width: 90,
  height: 90,
  marginTop: -45,
  marginLeft: -45,
  borderRadius: '50%',
  border: '4px solid',
  animation: 'reward-ring 0.5s ease-out both',
}
