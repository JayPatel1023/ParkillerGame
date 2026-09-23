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
const FORFEIT_COLORS = ['#8a7a6a', '#5c5248', '#43392f', '#7a3a2e']
const SPARK_COUNT = 18
// Eliminating an opposing Parkiller (PK6/PK7) reuses the plain capture's own star shape/orange
// palette (same "something magical" language - see STAR_CLIP_PATH's own doc comment) but with more
// sparks flying further, so it visibly reads as "bigger than a plain capture" rather than identical
// to one - see RING_COLOR/Burst below for the second half of that "bigger" treatment, an extra ring.
const PARKILLER_CAPTURE_SPARK_COUNT = 26
const SHARD_COUNT = 12

// Requested directly ("...재미난 음악효과와 장식효과를 주어야한다" - a capture should get fun
// decoration too, not just a notification): capture's own sparks used to be plain circles, same as
// finish's - reused PieceMesh.tsx's own five-pointed star shape (already established there as this
// game's "something magical is happening" language for children, not a scanning/UI-affordance
// shape) via a CSS clip-path instead, for capture's sparks specifically. Finish keeps its plain
// circles - it already gets its own separate on-board firework treatment (FinishCelebrationEffect),
// and the ask here was specifically about captures.
const STAR_CLIP_PATH = 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)'

// A jagged glass-shard quad, for the forfeited burst below - visually reads as "broken debris",
// distinct from the star (magic) and circle (glow) shapes the two success reasons already use.
const SHARD_CLIP_PATH = 'polygon(50% 0%, 100% 38%, 62% 100%, 15% 68%)'

type BurstReason = 'capture' | 'parkillerCapture' | 'finish' | 'forfeit'

interface Spark {
  angle: number
  distance: number
  delay: number
  size: number
  color: string
}

function useSparks(reason: BurstReason, seed: number): Spark[] {
  // seed forces a fresh random layout per grant (see toastKeyRef below) without needing a random
  // call outside render, which would break strict-mode double-invoke assumptions - useMemo keyed
  // on the grant identity is enough since a new grant already means a new seed value.
  return useMemo(() => {
    if (reason === 'forfeit') {
      // Requested directly ("Perdida" toast reported as unimpressive - see RewardToast.tsx's own
      // doc comment): unlike capture/finish's full-circle radiating sparks, these fall - angle is
      // constrained to the downward hemisphere (CSS rotate 0deg = +x/right, 90deg = straight down)
      // so the shards read as debris dropping away from the broken card, not a celebration.
      return Array.from({ length: SHARD_COUNT }, (_, i) => ({
        angle: (140 / SHARD_COUNT) * i + 20 + (Math.random() - 0.5) * 10,
        distance: 60 + Math.random() * 80,
        delay: Math.random() * 0.08,
        size: 6 + Math.random() * 6,
        color: FORFEIT_COLORS[Math.floor(Math.random() * FORFEIT_COLORS.length)],
      }))
    }
    const colors = reason === 'finish' ? FINISH_COLORS : CAPTURE_COLORS
    const count = reason === 'parkillerCapture' ? PARKILLER_CAPTURE_SPARK_COUNT : SPARK_COUNT
    // A Parkiller kill's own sparks fly noticeably further, on top of there simply being more of
    // them (count, above) - both read together as "a bigger hit" without changing the shape/color
    // language a plain capture already established.
    const distanceBoost = reason === 'parkillerCapture' ? 40 : 0
    return Array.from({ length: count }, (_, i) => ({
      angle: (360 / count) * i + (Math.random() - 0.5) * 14,
      distance: 70 + distanceBoost + Math.random() * 50,
      delay: Math.random() * 0.05,
      size: 5 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])
}

// parkillerCapture reuses the plain capture's own ring color (same orange "hit" language) - what
// makes it read as bigger is the *second* ring Burst renders below for this reason alone, not a
// different color here.
const RING_COLOR: Record<BurstReason, string> = { capture: '#ff6a4a', parkillerCapture: '#ff6a4a', finish: '#ffd24a', forfeit: '#6b4a3a' }

function Burst({ reason, seed }: { reason: BurstReason; seed: number }) {
  const sparks = useSparks(reason, seed)
  const isForfeit = reason === 'forfeit'
  // A Parkiller elimination (PK6/PK7) reuses the plain capture's own star-shaped, orange-glow
  // sparks (isStar below) - the client's "something magical" language for a capture, not a
  // different look - see RewardReason's own doc comment in turnManager.ts for why this event needs
  // to read as *bigger*, not differently themed.
  const isStar = reason === 'capture' || reason === 'parkillerCapture'
  return (
    <div style={burstWrapperStyle}>
      {/* Expanding ring shockwave - the "impact" half of the effect, distinct from the sparks'
          own "scatter" half so a capture (or a broken reward) reads as a hit, not just a sparkle. */}
      <div style={{ ...ringStyle, borderColor: RING_COLOR[reason] }} />
      {reason === 'parkillerCapture' && (
        // A second, delayed, bigger ring - the same overlapping-double-ring trick
        // FinishCelebrationEffect.tsx already uses for the on-board finish burst (two expanding
        // rings, the second started slightly later and ending bigger) - so eliminating an opposing
        // Parkiller visibly reads as a bigger hit than a plain capture's single ring, not an
        // identical one just relabeled.
        <div style={{ ...ringStyle, borderColor: RING_COLOR[reason], animation: 'reward-ring-2 0.65s ease-out 0.1s both' }} />
      )}
      {sparks.map((s, i) => (
        <span
          key={i}
          style={
            {
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: isStar ? s.size * 1.6 : s.size,
              height: isStar ? s.size * 1.6 : s.size,
              borderRadius: reason === 'finish' ? '50%' : 0,
              clipPath: isStar ? STAR_CLIP_PATH : isForfeit ? SHARD_CLIP_PATH : undefined,
              background: s.color,
              boxShadow: reason === 'finish' ? `0 0 6px ${s.color}` : 'none',
              filter: isStar ? `drop-shadow(0 0 4px ${s.color})` : undefined,
              '--angle': `${s.angle}deg`,
              '--distance': `${s.distance}px`,
              animation: isForfeit
                ? `reward-shard-fall 0.85s cubic-bezier(0.55, 0, 0.85, 0.35) ${s.delay}s both`
                : `reward-spark 0.6s ease-out ${s.delay}s both`,
            } as React.CSSProperties
          }
        />
      ))}
      <style>{`
        @keyframes reward-spark {
          0% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(0) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(var(--distance)) scale(0.3); opacity: 0; }
        }
        @keyframes reward-shard-fall {
          0% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(0) rotate(0deg); opacity: 1; }
          100% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(var(--distance)) rotate(240deg); opacity: 0; }
        }
        @keyframes reward-ring {
          0% { transform: scale(0.2); opacity: 0.8; border-width: 4px; }
          100% { transform: scale(2.6); opacity: 0; border-width: 1px; }
        }
        @keyframes reward-ring-2 {
          0% { transform: scale(0.4); opacity: 0.7; border-width: 4px; }
          100% { transform: scale(3.4); opacity: 0; border-width: 1px; }
        }
      `}</style>
    </div>
  )
}

export function RewardBurst({
  pendingReward,
  forfeitedReward,
}: {
  pendingReward: RewardGrant | null
  forfeitedReward: RewardGrant | null
}) {
  // Used to skip the forfeited case entirely - a lost reward felt like the opposite of exciting, so
  // it got no burst at all. Reversed on direct request ("Perdida" toast called out as flat/boring,
  // asked for flashier visuals - see RewardToast.tsx's own doc comment): now fires its own distinct
  // "falling shards" burst (downward-biased debris, not radiating sparks/stars) instead of reusing
  // the success reasons' celebratory look, so it reads as dramatic without reading as a win.
  const shown = pendingReward ?? forfeitedReward
  const reason: BurstReason = pendingReward ? pendingReward.reason : 'forfeit'

  // Incrementing this key *during render* (the first version of this component did) reruns on
  // every render where a reward is showing, not just when a new grant actually arrives - since
  // GameBoardScreen re-renders continuously while a reward is pending (piece animations, etc.),
  // that remounted Burst on nearly every frame, permanently resetting its own CSS animation back to
  // its very first, barely-visible instant - confirmed directly via a Playwright capture sequence
  // that never caught the sparks mid-flight despite sampling well within the animation's own
  // duration. A useEffect keyed on the grant itself, the same pattern RewardToast's own
  // toastKeyRef already uses, only fires once per actual new grant.
  const burstKeyRef = useRef(0)
  useEffect(() => {
    if (shown) burstKeyRef.current++
  }, [pendingReward, forfeitedReward])

  if (!shown) return null
  return <Burst key={burstKeyRef.current} reason={reason} seed={burstKeyRef.current} />
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
