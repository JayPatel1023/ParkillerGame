import { useEffect, useRef, useState } from 'react'
import type { RewardGrant, RewardReason } from '../core/gameFlow/turnManager'
import { ToastFadeOutTracker, type ToastDisplayState } from '../hooks/toastFadeOutHold'

// A capture/finish reward used to be a single small text line tucked into the corner HUD panel -
// reported directly as feeling too serious/stiff for what should be an exciting moment ("사람들이
// 스트레스를 풀수있게... 재미난 감이 들게"). This is a proper celebratory pop-in toast instead:
// bounces in center-stage, holds briefly, fades out - the kind of "+20!" moment other games give a
// capture, not a status line you might not even notice.
//
// That "fades out" was only ever the intent, not the reality - see ToastFadeOutTracker's own doc
// comment (src/hooks/toastFadeOutHold.ts) for how close video review of a real local recording
// caught this component returning null (a hard, instant cut) the moment its held value cleared,
// with no fade-out ever defined at all. FADE_OUT_MS/the tracker below fix that without touching
// how LONG the toast holds first - that part (GameBoardScreen.tsx's own useHeldAlert) was already
// correct.
const FADE_OUT_MS = 350

// The forfeited ("Perdida") variant reused this same flat pop-in and a plain gray card - reported
// directly as unimpressive ("이런알림은 멋이없다... 더화려한 시각적효과... 더멋진 애니메이션효과와
// 멋진 3D효과를넣어달라" - this notification isn't cool, give it flashier visuals, better animation,
// a nice 3D effect). Gets its own distinct treatment instead of the success cards' golden
// celebration (a *lost* reward staying golden/festive would read as the wrong emotion): a real CSS
// 3D perspective/rotateX flip-down (an actual 3D effect, not just scale/translate), a cracked-glass
// overlay that flashes on impact, and a light-sweep shine across the card - dramatic and eye-
// catching without looking like a win. RewardBurst.tsx pairs this with its own falling-shard
// particle burst behind the card.
// Reported directly, and confirmed against current source rather than assumed fixed already:
// eliminating an opposing Parkiller (PK6/PK7) shared this exact 'capture' reason with an everyday
// pawn capture, so it showed the same generic "¡Captura!" text as a plain capture - despite the
// client explicitly treating a Parkiller kill as the bigger, separately-noteworthy event. Its own
// distinct reason ('parkillerCapture' - see RewardReason's own doc comment) now gets its own label.
function rewardLabel(reason: RewardReason): string {
  if (reason === 'parkillerCapture') return '¡Parki eliminado!'
  return reason === 'capture' ? '¡Captura!' : '¡Meta!'
}

interface ShownContent {
  shown: RewardGrant
  isForfeited: boolean
}

export function RewardToast({ pendingReward, forfeitedReward }: { pendingReward: RewardGrant | null; forfeitedReward: RewardGrant | null }) {
  // A fresh key per new grant remounts the toast, restarting its CSS animation even when two
  // captures in a row happen to share the same amount/reason (same object shape, different event).
  const toastKeyRef = useRef(0)
  const shown = pendingReward ?? forfeitedReward
  const isForfeited = !pendingReward && forfeitedReward !== null

  // Drives the actual render below - see ToastFadeOutTracker's own doc comment. Initialized from
  // the current props so a toast that's already showing on this component's very first render
  // (rare, but possible on a remount) doesn't need an extra render pass to appear.
  const [display, setDisplay] = useState<ToastDisplayState<ShownContent> | null>(
    shown ? { content: { shown, isForfeited }, exiting: false } : null,
  )
  // Lazy-initialized once per component instance (not per render), same pattern as
  // useTurnManager.ts's own captureFlightHoldRef.
  const fadeTrackerRef = useRef<ToastFadeOutTracker<ShownContent> | null>(null)
  if (!fadeTrackerRef.current) fadeTrackerRef.current = new ToastFadeOutTracker(setDisplay, FADE_OUT_MS)
  // What `show` most recently reported - `hide` needs it below since, by the time a render sees
  // pendingReward/forfeitedReward both go null, `shown` itself is already null and can't be
  // passed as the content to keep fading against.
  const lastContentRef = useRef<ShownContent | null>(display?.content ?? null)

  useEffect(() => {
    if (shown) {
      toastKeyRef.current++
      const content = { shown, isForfeited }
      lastContentRef.current = content
      fadeTrackerRef.current?.show(content)
    } else if (lastContentRef.current) {
      fadeTrackerRef.current?.hide(lastContentRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingReward, forfeitedReward])

  // Unmount only, matching CaptureFlightHoldTracker's own dispose() usage - no state left to
  // update after this.
  useEffect(() => () => fadeTrackerRef.current?.dispose(), [])

  if (!display) return null
  const displayedForfeited = display.content.isForfeited
  const displayedShown = display.content.shown
  const popClass = displayedForfeited ? 'reward-toast-forfeit-pop' : 'reward-toast-pop'
  const cardClassName = display.exiting ? `${popClass} reward-toast-fade-out` : popClass

  return (
    <div key={toastKeyRef.current} style={wrapperStyle}>
      <div style={displayedForfeited ? forfeitedCardStyle : cardStyle} className={cardClassName}>
        {displayedForfeited && (
          <>
            {/* Cracked-glass overlay - a handful of jagged lines flashing bright on impact then
                settling to a faint permanent crack, reinforcing "broken/lost" for the whole toast's
                lifetime rather than just at the entrance beat. */}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={crackOverlayStyle}>
              <polyline points="18,0 30,38 12,55 26,100" />
              <polyline points="58,0 46,30 68,48 54,100" />
              <polyline points="30,38 68,48" />
              <polyline points="88,10 70,45 100,60" />
            </svg>
            {/* Light-sweep shine - a single diagonal highlight band crossing the card once, the
                cheap CSS way to sell "glossy 3D surface catching the light" without a real material. */}
            <div style={shineSweepStyle} />
          </>
        )}
        <div style={displayedForfeited ? forfeitedAmountStyle : amountStyle}>
          {displayedForfeited ? 'Perdida' : `+${displayedShown.amount}`}
        </div>
        <div style={displayedForfeited ? forfeitedLabelStyle : labelStyle}>
          {displayedForfeited ? `Recompensa de ${displayedShown.amount} sin ficha disponible` : rewardLabel(displayedShown.reason)}
        </div>
      </div>
      <style>{`
        @keyframes reward-toast-pop {
          0% { transform: scale(0.4) translateY(14px); opacity: 0; }
          55% { transform: scale(1.08) translateY(-4px); opacity: 1; }
          75% { transform: scale(0.97) translateY(0); }
          100% { transform: scale(1) translateY(0); }
        }
        .reward-toast-pop { animation: reward-toast-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both; }

        /* A real 3D flip-down (perspective + rotateX), like a trapdoor card landing face-up, rather
           than the success toast's flat scale/translate pop - distinct entrance for a distinct,
           less-celebratory event. */
        @keyframes reward-toast-forfeit-pop {
          0% { transform: perspective(700px) rotateX(-78deg) scale(0.6) translateY(10px); opacity: 0; }
          55% { transform: perspective(700px) rotateX(14deg) scale(1.06) translateY(-6px); opacity: 1; }
          75% { transform: perspective(700px) rotateX(-4deg) scale(0.98) translateY(0); }
          100% { transform: perspective(700px) rotateX(0deg) scale(1) translateY(0); }
        }
        .reward-toast-forfeit-pop {
          animation: reward-toast-forfeit-pop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both;
          transform-style: preserve-3d;
        }

        /* The actual fade-out this file's own doc comment always promised (see
           ToastFadeOutTracker's own doc comment, src/hooks/toastFadeOutHold.ts, for how it was
           missing entirely until now). Declared after both pop classes above, and at the same
           (single-class) specificity, so - by plain CSS cascade order, no !important needed -
           this rule's own \`animation\` wins outright over whichever pop animation the card
           already finished playing, instead of the two trying to blend. */
        @keyframes reward-toast-fade-out {
          0% { opacity: 1; transform: scale(1) translateY(0); }
          100% { opacity: 0; transform: scale(0.92) translateY(-6px); }
        }
        .reward-toast-fade-out { animation: reward-toast-fade-out ${FADE_OUT_MS}ms ease-in both; }

        @keyframes reward-toast-crack-flash {
          0% { opacity: 0; }
          45% { opacity: 1; }
          65% { opacity: 0.9; }
          100% { opacity: 0.4; }
        }

        @keyframes reward-toast-shine {
          0% { transform: translateX(-140%) skewX(-20deg); }
          100% { transform: translateX(240%) skewX(-20deg); }
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
  // Anchors the crack-overlay/shine-sweep children (both position:absolute, inset-0) to the card
  // itself, and clips the shine sweep to the card's own rounded shape instead of spilling past it.
  position: 'relative',
  overflow: 'hidden',
}

const amountStyle: React.CSSProperties = {
  fontSize: 34,
  fontWeight: 800,
  color: '#2a2210',
  textShadow: '0 1px 0 rgba(255,255,255,0.4)',
  lineHeight: 1,
}

const forfeitedAmountStyle: React.CSSProperties = {
  ...amountStyle,
  color: '#f0e6d2',
  textShadow: '0 1px 0 rgba(0,0,0,0.5), 0 0 10px rgba(0,0,0,0.35)',
}

const labelStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#2a2210',
  opacity: 0.85,
}

const forfeitedLabelStyle: React.CSSProperties = {
  ...labelStyle,
  color: '#f0e6d2',
  opacity: 0.8,
}

const crackOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  fill: 'none',
  stroke: 'rgba(255,255,255,0.55)',
  strokeWidth: 1.4,
  strokeLinejoin: 'round',
  animation: 'reward-toast-crack-flash 0.6s ease-out 0.15s both',
  pointerEvents: 'none',
}

const shineSweepStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '40%',
  height: '100%',
  background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0) 100%)',
  animation: 'reward-toast-shine 0.9s ease-out 0.25s both',
  pointerEvents: 'none',
}
