import { useEffect, useRef, useState } from 'react'
import type { BoardDefinition } from '../core/board/boardDefinition'
import type { PlayerState } from '../core/gameFlow/playerState'
import { getColor } from '../core/colorPalette'
import type { StartingPlayerResult } from '../core/gameFlow/startingPlayer'
import type { Listenable, TurnManagerLike } from '../core/gameFlow/turnManagerLike'
import type { PieceColor } from '../core/pieceColor'
import type { Piece } from '../core/pieces/piece'
import type { MoveOption } from '../core/rules/moveOption'
import { useTurnManager } from '../hooks/useTurnManager'
import { BoardScene } from '../scene/BoardScene'
import { InteractiveCursorOverlay } from '../scene/InteractiveCursorOverlay'
import { getHopSoundLabel, getSelectedHopSoundIndex, nextHopSound, playHopSound } from '../scene/hopSound'
import { playCaptureFanfare, playCaptureSound, playFinishSound, playGameWonSound } from './celebrationSound'
import { ColorDrawModal, type ColorDrawEntry } from './ColorDrawModal'
import { Confetti } from './Confetti'
import { EliminationToast } from './EliminationToast'
import { heldAlertClearDelayMs } from './heldAlertTiming'
import { HelpModal } from './HelpModal'
import { getSelectedTrackIndex, getTrackLabel, isMusicMuted, nextMusicTrack, toggleMusicMuted } from './introMusic'
import { PlayerLeftToast } from './PlayerLeftToast'
import { RewardBurst } from './RewardBurst'
import { RewardToast } from './RewardToast'
import { StartingPlayerModal } from './StartingPlayerModal'

// Reported directly, with a photoreal reference (ornate leather-and-gold game table, candlelit):
// match its background mood plus its buttons' style/shape/position. This trim color used to be
// the royal-blue accent picked for Start/Lobby - this screen now breaks from that to an actual
// warm gold matching the new reference, since Start/Lobby weren't part of this ask.
const BRAND_GOLD = '#c9a24b'

// Lightens (positive percent) or darkens (negative) a hex color - used to derive a per-player
// gradient/shadow/border from just that player's base swatch (core/colorPalette.ts), so the turn
// card's roll button reads in the current player's own color like the reference's red-bordered
// card on red's turn, without hand-authoring a gradient per color.
function shade(hex: string, percent: number): string {
  const num = parseInt(hex.slice(1), 16)
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + Math.round(255 * percent)))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + Math.round(255 * percent)))
  const b = Math.min(255, Math.max(0, (num & 0xff) + Math.round(255 * percent)))
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

// Reported directly ("잡아먹거나 어떤때 alert화면이 뜰때 너무 빨리 떳다 없어졌다. 자연스럽게 사람이
// 볼수잇게 알수있게 해달라" - when a capture happens, or some other alert screen shows up, it pops
// up and vanishes too fast - make it natural, so people can actually see and register it):
// visiblePendingReward/visibleForfeitedReward/eliminatedByDoubles previously stayed visible only
// until *whatever happened next* cleared them - most commonly the very next move's own moveApplied
// (see useTurnManager.ts's own handler, which nulls pendingReward unconditionally on every move) or
// the next roll, either of which can follow within a couple of seconds under bot play or a fast
// human turn, well before there's been real time to actually read it. Same class of bug
// useTurnManager.ts's own TURN_CHANGE_HOLD_MS already fixed for a different case (a barrier-locked
// roll) - reused as the same duration here for consistency.
//
// Applied to the already animation-gated visible* values (not the raw pendingReward/
// forfeitedReward useTurnManager returns), specifically so the hold clock only ever starts once a
// toast has actually appeared on screen post-animation-settle - moveApplied unconditionally nulls
// the raw value on every subsequent move regardless of what that move itself does, so a later,
// unrelated move's own animation settling again can never make a stale grant "reappear" here.
// Reported directly ("알림은 약 3초동안은 유지하게해줘" - keep the notification up for about 3
// seconds): bumped from 2000 - still squarely inside the client's own previously-stated "2 o 3
// segundos" range for a bot's own pacing (see HUMAN_REVEAL_HOLD_MS's own doc comment just below),
// just at the top of it instead of the bottom.
const ALERT_HOLD_MS = 3000

// ceiling/blockClear/lingerMs are all opt-in for the dice display only - see heldAlertTiming.ts for
// why (the dice's source value stays live for a whole roll, unlike a toast's). Every other caller
// keeps the exact behavior it had: max-hold ceiling on, never blocked, no linger.
interface HeldAlertOptions {
  ceiling?: boolean
  blockClear?: boolean
  lingerMs?: number
}

function useHeldAlert<T>(value: T | null, holdMs: number = ALERT_HOLD_MS, options: HeldAlertOptions = {}): T | null {
  const { ceiling = true, blockClear = false, lingerMs = 0 } = options
  const [held, setHeld] = useState<T | null>(value)
  const shownAtRef = useRef(0)
  // When blockClear last went false (animations just finished) - the linger is measured from that
  // moment, so a value whose animations settled long ago (a turn handoff, which already waits for
  // them) isn't held any longer than it used to be. Declared before the main effect on purpose:
  // effects run in declaration order, and that effect reads this on the same commit.
  const unblockedAtRef = useRef(Date.now())
  const prevBlockedRef = useRef(blockClear)
  useEffect(() => {
    if (prevBlockedRef.current && !blockClear) unblockedAtRef.current = Date.now()
    prevBlockedRef.current = blockClear
  }, [blockClear])
  // Requested directly - see HUMAN_REVEAL_HOLD_MS's own doc comment: a human's own turn now holds
  // its dice/reward reveals far longer than a bot's, so callers pass a `holdMs` that changes from
  // render to render (whoever's turn is currently live), not the fixed constant this hook
  // originally always got. Captured here only at the exact moment `value` goes from null to fresh -
  // not read again from `holdMs` directly during the decay countdown below - so a *later* render
  // where the caller's own holdMs has already moved on to a different player's speed (most notably
  // once currentPlayer itself has advanced to whoever's turn is next) can't retroactively shrink or
  // stretch a countdown that's already running for the value it was actually shown for.
  const holdMsRef = useRef(holdMs)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
    if (value !== null) {
      // A fresh (or still-current) alert - show it right away and restart the hold clock, so a
      // second distinct event arriving mid-hold still gets its own full viewing time rather than
      // inheriting whatever was left of the first one's countdown.
      setHeld(value)
      shownAtRef.current = Date.now()
      holdMsRef.current = holdMs
      // Bug found by close video review of a real local recording (b2_0586.jpg onward): the
      // forfeited-reward "Perdida" toast stayed on screen unchanged through an entire turn
      // handoff and the next player's whole idle-nudge/warning/countdown cycle - ~40+ seconds,
      // not the ~20s HUMAN_REVEAL_HOLD_MS this hook is meant to cap it at. Root cause: this
      // branch used to only *record* shownAtRef/holdMsRef and return, arming no timer of its own -
      // the actual setTimeout lived solely in the value===null branch below, so the alert only
      // ever cleared once the caller's raw source value (forfeitedReward/pendingReward/etc. in
      // useTurnManager.ts) itself transitioned back to null, which only happens on that *same*
      // player's own next diceRolled/moveApplied. If that player instead goes idle, the raw value
      // never clears, this effect never re-runs, and the held alert is stuck indefinitely - the
      // hold was enforcing a minimum display time, never the maximum it was meant to be. Arming
      // the clear timer here too closes that gap: it lands on the exact same shownAt+holdMs
      // deadline the value===null branch already computes below, so a fast-following event still
      // gets its full minimum hold unchanged - this just also guarantees the alert self-clears by
      // holdMs even if the source value never goes back to null on its own. The dice display opts
      // out (ceiling: false): its source stays live for the whole roll, so a ceiling wiped the
      // numbers mid-move - see heldAlertTiming.ts.
      if (ceiling) clearTimerRef.current = setTimeout(() => setHeld(null), holdMs)
      return () => {
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      }
    }
    const delay = heldAlertClearDelayMs({
      elapsedMs: Date.now() - shownAtRef.current,
      holdMs: holdMsRef.current,
      lingerMs,
      msSinceUnblocked: Date.now() - unblockedAtRef.current,
      blocked: blockClear,
    })
    // Blocked: keep what's held and wait - this effect re-runs the moment blockClear flips false.
    if (delay === null) return
    clearTimerRef.current = setTimeout(() => setHeld(null), delay)
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, holdMs, blockClear])

  return held
}

// Bug found by close video review of a real local recording (b1_0451.jpg): with a reward already
// chosen and its piece visibly hopping forward square by square, the turn-status header stayed
// frozen on "Elija una ficha para su recompensa" for the whole ~10-12s of that animation. Root
// cause: the header used to read the same useHeldAlert-derived visiblePendingReward the toast/
// burst use, which - by design, see useHeldAlert's own doc comment above - keeps returning its
// last truthy value for a while after the underlying pendingReward goes back to null, so the
// toast doesn't "pop up and vanish too fast". Choosing a reward piece nulls the raw pendingReward
// and starts that piece's own move animation in the same tick (useTurnManager.ts's moveApplied
// handler), so animationsSettled goes false at the same instant - but useHeldAlert only decays
// toward null over its hold window, so the header kept the stale prompt up for that whole window
// (HUMAN_REVEAL_HOLD_MS - 20s locally - comfortably covering the hop animation). This is the fix:
// a plain, ungated snapshot of "is a reward choice genuinely still open right now", mirroring how
// visiblePendingMoves (this file) already tracks its own live equivalent with no hold at all.
// Exported as a small pure function - rather than left inlined - purely so it has a seam this
// component's own test-free (no React-rendering infra here) file otherwise wouldn't: see
// tests/gameBoardRewardStatus.test.ts.
export function computeAwaitingRewardChoice<T>(params: {
  isMyTurn: boolean
  rolling: boolean
  animationsSettled: boolean
  paused: boolean
  pendingReward: T | null
}): T | null {
  const { isMyTurn, rolling, animationsSettled, paused, pendingReward } = params
  return isMyTurn && !rolling && animationsSettled && !paused ? pendingReward : null
}

// Bug found by close video review of a real local recording (b2_0248.jpg, sandwiched between
// b2_0247.jpg and b2_0249.jpg): with a piece choice genuinely still open the whole time - dice
// values, pawn positions and the roll button's own state all identical across the three frames -
// the turn-status header flickered from "Elija una ficha para mover" to the stale "Dados: X y Y ·
// Parkiller: Z" line and back, for a single frame, then never again for the rest of that same
// choice. Root cause: the header used to read visiblePendingMoves.length > 0 (this file) -
// deliberately ANDed with animationsSettled so a piece can't be *selected* out of order mid-
// animation, see that value's own comment above - but that same AND makes the header just as
// sensitive to animationsSettled as piece-selectability is, and a momentary rolling/
// animationsSettled dip, even one with no visible on-screen animation to justify it, empties
// visiblePendingMoves for a tick; statusLine then falls straight through to the already-held,
// stale visibleRoll case below it. This is the fix, mirroring computeAwaitingRewardChoice just
// above: a snapshot of "is a move choice genuinely still open right now for the header" gated only
// on what the *text* actually needs (isMyTurn, !rolling, !paused) and deliberately not on
// animationsSettled - unlike visiblePendingMoves itself, which keeps that gate untouched
// everywhere it actually drives interactivity (BoardScene's own pendingMoves prop,
// handleSelectPiece, autoPlayIdleTurn). !rolling stays required on its own: pendingMoves populates
// synchronously well before the dice-spin reveal finishes (see visiblePendingMoves's own comment),
// so dropping that too would show this text mid-spin - the same "every step in order" bug already
// fixed once for piece selectability, just recurring in this line instead. Exported as its own
// pure function for the same reason computeAwaitingRewardChoice is: see
// tests/gameBoardMoveChoiceStatus.test.ts.
export function computeAwaitingMoveChoice<T>(params: {
  isMyTurn: boolean
  rolling: boolean
  paused: boolean
  pendingMoves: T[]
}): T[] {
  const { isMyTurn, rolling, paused, pendingMoves } = params
  return isMyTurn && !rolling && !paused ? pendingMoves : []
}

// See idleTriggerActive's own doc comment (where this is called) for the report this fixes -
// opening Help/Sound-Settings/the exit-confirm dialog and leaving it open used to let the idle
// nudge/warning/auto-play sequence keep running (and, once its own countdown hit 0, actually play
// the player's turn for them) right underneath it, since none of those three were ever checked
// here before, only `paused` was.
export function computeIdleTriggerActive(params: {
  canRoll: boolean
  awaitingPieceChoice: boolean
  showingHelp: boolean
  showingSoundSettings: boolean
  confirmingExit: boolean
}): boolean {
  const { canRoll, awaitingPieceChoice, showingHelp, showingSoundSettings, confirmingExit } = params
  return (canRoll || awaitingPieceChoice) && !showingHelp && !showingSoundSettings && !confirmingExit
}

// Bug found by close video review of a real local recording (b2_0353.jpg vs b2_0355.jpg, ~2s
// apart): right as a turn hands off to a *different* player after a long move (any capture/finish
// reward - REWARD_UNIT*2=20 or a split 10, see turnManager.ts - or a plain sum-dice move of 7+),
// the banner switched to this player's "Tire los dados para empezar su turno" roll prompt the
// instant useTurnManager's own fixed TURN_CHANGE_HOLD_MS (3000ms) elapsed - but the roll button
// right next to it (disabled={!canRoll}) stayed dark for another moment, because canRoll also
// requires animationsSettled, which doesn't catch up until the outgoing move's own hop animation
// genuinely finishes (HOP_DURATION 0.48s per square, hop count = pip count - piecePosition.ts's
// getHopWaypoints - so any 7+ move already outruns the fixed 3s hold). Every other branch of
// statusLine below is gated on animationsSettled (directly, or via something that is, e.g.
// awaitingRewardChoice/pendingMoves.length>0&&!rolling/visibleRoll's own held value having already
// decayed) before it can ever reach this literal string - this was the one branch that wasn't,
// so for that ~1-2s window the banner told the player to roll while the button they'd click to do
// it was still visibly refusing them. Gating on canRoll here can't disagree with the button, since
// canRoll is the exact same value the button already reads (see cardRollButtonStyle/disabled
// below) - this is a plain seam so that guarantee has a test, same reasoning as
// computeAwaitingRewardChoice just above: see tests/gameBoardRollPromptStatus.test.ts.
export function computeRollPromptStatusLine(params: { canRoll: boolean }): string {
  return params.canRoll ? 'Tire los dados para empezar su turno' : 'Un momento…'
}

// Bug found by close video review of a real local recording (b3_0131.jpg, sandwiched between
// b3_0130.jpg and b3_0133.jpg): right as a bot's roll that left it with zero legal moves handed
// the turn straight to the next (different) player, that next player's freshly-flipped "TURNO DE
// X" header showed the *previous* player's own "Dados: A y B · Parkiller: C" numbers for about two
// seconds - despite no piece anywhere on the board actually moving in that window - before
// collapsing to the correct "Tire los dados para empezar su turno" prompt. Root cause:
// turnManager.ts's own requestRoll fires diceRolled, moveNotPossible('none') and
// turnStarted(nextPlayer) all synchronously for that kind of forfeited roll, so useTurnManager.ts
// arms two *independent* timers off that same instant: DICE_SPIN_MS (2000ms) later, diceRolled's
// own handler sets the real `lastRoll` (still the forfeiting player's own roll, since
// currentPlayer hasn't flipped yet); TURN_CHANGE_HOLD_MS (3000ms) later, turnStarted's
// different-player branch flips currentPlayer to the next player and nulls the underlying
// lastRoll. visibleRoll (useHeldAlert, GameBoardScreen's own render body) captures its display
// hold at the *first* of those two instants - while currentPlayer is still the forfeiting player -
// so by the time currentPlayer flips a second later, visibleRoll's own hold clock (holdMsFor's
// short bot pacing, captured before the flip) still has time left on it and keeps returning that
// stale roll, now rendered under the new player's header. A normal (non-forfeited) bot move takes
// long enough for the hold to have already expired by the time the handoff completes, which is why
// this only surfaces on an immediately-forfeited roll.
//
// Fixed by tracking whose turn a given roll actually belongs to - GameBoardScreen's own
// rollOwnerRef, captured at the exact instant lastRoll first goes non-null, which (per the timing
// above) is always still that roller's own turn for both this handoff case and the ordinary
// same-player-bonus case - and refusing to show visibleRoll's numbers under any *other* player's
// header, however much of its own display hold is still left. Exported as its own pure function,
// same reasoning as computeAwaitingRewardChoice/computeAwaitingMoveChoice/
// computeRollPromptStatusLine above: this component has no React-rendering test infra, so
// tests/turnRollOwnership.test.ts exercises this gating directly instead.
export function computeVisibleRollForOwner<T>(params: {
  visibleRoll: T | null
  rolling: boolean
  rollOwnerColor: PieceColor | null
  currentPlayerColor: PieceColor
}): T | null {
  const { visibleRoll, rolling, rollOwnerColor, currentPlayerColor } = params
  return visibleRoll && !rolling && rollOwnerColor === currentPlayerColor ? visibleRoll : null
}

// Found via a real local (vs-bots) recording (b2_0369 onward): once it became a bot's turn, the
// turn-status subtitle froze on "Esperando el turno de X..." for that bot's *entire* turn, never
// updating even while the dice were visibly rolling (the roll button flipping RODANDO.../TIRAR
// DADOS, the physical dice changing 1&3 -> 6&6 -> 1&1) and a pawn was visibly animating out of its
// yard along the track. Root cause: the plain `!isMyTurn` branch this replaces was built (commit
// da4c6dc) purely for ONLINE's untrusted-other-client case, where isMyTurn is false because the
// turn genuinely belongs to a different device and there's nothing else honest to report - but
// commit cb3c95b later reused that exact same localPlayerColor/isMyTurn plumbing for local
// vs-bots play too ("so GameBoardScreen needed zero changes"), which silently swept a bot's whole
// turn under that same online-only placeholder. useTurnManager.ts's own diceRolled/
// moveChoicesReady handlers populate rolling/lastRoll/pendingMoves/pendingReward identically
// regardless of whose turn it is (see that file's own "fires...regardless of who triggered it"
// comment) - the data was there the whole time, GameBoardScreen just never read it for anyone but
// the local human.
//
// This is that missing read: takes the *raw* rolling/pendingMoves/pendingReward/visibleRoll (not
// the isMyTurn-gated visible*/awaiting* values GameBoardScreen derives for interaction-gating
// purposes, which are always empty/null during a bot's turn since isMyTurn is false there) and
// narrates them in third person instead of the human-directed imperative copy those drive
// ("Elija..."). Purely a text choice, not a gate - canRoll/awaitingPieceChoice/visiblePendingMoves
// stay isMyTurn-gated exactly as before, so a bot's turn still can't be clicked into. Falls back
// to the same plain "Esperando el turno de X..." placeholder for a genuine online other-client
// turn (!isLocalGame - online never reaches any of the bot-specific branches below, since only
// local play ever has bot seats at all) and for a local bot's turn before its first roll has
// actually landed. Exported as its own pure function, same as computeAwaitingRewardChoice just
// above, for the same reason: this component has no React-rendering test infra, so
// tests/gameBoardBotStatus.test.ts exercises this directly instead.
export function computeBotStatusLine(params: {
  isLocalGame: boolean
  rolling: boolean
  animationsSettled: boolean
  pendingReward: unknown
  pendingMoves: unknown[]
  visibleRoll: { dieA: number; dieB: number; blackDie: number } | null
  isDouble: boolean
  currentPlayerColor: string
}): string {
  const { isLocalGame, rolling, animationsSettled, pendingReward, pendingMoves, visibleRoll, isDouble, currentPlayerColor } = params
  const waiting = `Esperando el turno de ${currentPlayerColor}...`
  if (!isLocalGame) return waiting
  if (rolling) return `${currentPlayerColor} está tirando los dados...`
  if (animationsSettled && pendingReward) return `${currentPlayerColor} está eligiendo una ficha para su recompensa...`
  if (animationsSettled && pendingMoves.length > 0) return `${currentPlayerColor} está eligiendo una ficha...`
  if (visibleRoll) {
    return `Dados: ${visibleRoll.dieA} y ${visibleRoll.dieB}${isDouble ? ' (dobles)' : ''} · Parkiller: ${visibleRoll.blackDie} · ${currentPlayerColor} está jugando...`
  }
  return waiting
}

// Bug found by close video review of a real local recording (b2.mp4, ~t=106-119s, two-player
// hotseat, Red's turn): with a piece choice genuinely still open the whole window - dice values,
// pawn positions and every button state identical throughout, no piece ever completing a new hop
// - the turn-status *text* flickered between "Elija una ficha para mover" and the stale "Dados: X
// y Y · Parkiller: Z" line three times over ~13 seconds. computeAwaitingMoveChoice above already
// fixes that exact text (a live snapshot no longer gated on animationsSettled at all) - but
// visiblePendingMoves/canRoll (GameBoardScreen, both still deliberately gated on animationsSettled
// for interactivity - see visiblePendingMoves's own comment on why piece selectability needs that)
// were the actual root cause underneath the text symptom, and are untouched by that fix: every
// piece's own selectable glow and the TIRAR DADOS button itself kept flickering off and back on in
// lockstep with the same repeated animationsSettled dips, just no longer narrated by the header.
//
// Root cause: captureFlightHold.ts's own CaptureFlightHoldTracker.trigger() (useTurnManager.ts)
// re-arms captureFlightPending - one of the three flags animationsSettled ANDs together - off ANY
// capture's own trailing edge, including one from an EARLIER move wholly unrelated to whichever
// pendingMoves choice or roll opportunity is currently on screen. Each retrigger flips
// animationsSettled back to false for CAPTURE_RETURN_HOPS*HOP_DURATION_MS (~1.44s), and
// visiblePendingMoves/canRoll re-collapse the instant that happens, with nothing keeping an
// already-revealed choice/roll-button state on screen through a dip that has nothing to do with
// it - a chain of several such captures across one long turn is exactly what stretches this into
// several ~1.4s blips over many seconds instead of one single-frame flicker.
//
// computeAnimationsSettledForPendingMoves is the fix, playing the same role for interactivity that
// computeAwaitingMoveChoice plays for the text: latches "animationsSettled has been true at least
// once for this exact `pendingMoves` reference" and keeps returning true for that same reference
// even if animationsSettled dips again afterward. A brand new `pendingMoves` reference - every
// real roll/move resolving hands back a fresh array, see useTurnManager.ts's own
// setPendingMoves([])/setPendingMoves(moves) calls - still has to wait on a genuine
// animationsSettled=true first, so a piece still can't become selectable (or the roll button
// re-enable) before its own animation has actually settled; only an *already-revealed* value stops
// being re-masked by an unrelated later dip.
//
// Deliberately a plain function threading its own previous return value back in via the caller's
// ref (see its call site), not a React hook of its own - same reasoning as
// CaptureFlightHoldTracker (captureFlightHold.ts) and every other compute* function in this file:
// no React-rendering test infra here, so this needs a seam plain vitest can call directly - see
// tests/gameBoardPendingMovesSettled.test.ts.
export function computeAnimationsSettledForPendingMoves<T>(
  prev: { pendingMoves: T; settled: boolean } | undefined,
  pendingMoves: T,
  animationsSettled: boolean,
): { pendingMoves: T; settled: boolean } {
  if (!prev || prev.pendingMoves !== pendingMoves) return { pendingMoves, settled: animationsSettled }
  if (animationsSettled && !prev.settled) return { pendingMoves, settled: true }
  return prev
}

// Reported directly, with a screenshot of the resting dice ("주사위가 항상 말들이 움직인다음에는
// 이상태로 되돌아갔다가 다시 돌아가게 되여있다... 속도가 너무 빨리 되돌아가니까 내가 도대체 말의
// 수가 얼마였는지 모르겠다" - after the pieces move the dice always reset and spin again, but it
// resets so fast I can't tell what the roll even was): useTurnManager's own `lastRoll` nulls out
// the *instant* turnStarted fires - which happens the moment this roll's dice are fully spent, well
// before there's been any real chance to read the numbers, even for a same-player bonus turn (see
// useTurnManager.ts's own turnStarted handler - it fires, and clears lastRoll, on every turn
// transition, not just a handoff to a different player). A bit more generous than ALERT_HOLD_MS -
// two or three numbers to read and cross-reference against which pieces just moved takes longer to
// register than a single toast message. Bumped by the same amount ALERT_HOLD_MS just was, so that
// gap between the two stays what it was rather than shrinking to a fraction of itself.
const DICE_DISPLAY_HOLD_MS = 3800

// How long the dice numbers stay up after the last piece involved in this roll has landed - see
// heldAlertTiming.ts. Long enough to read the final numbers against where the piece ended up, short
// enough not to drag the next roll.
const DICE_POST_MOVE_LINGER_MS = 1500

// Reported directly ("hay que dejar 20 segundos de espacio de tiempo entre cada movimiento de cada
// peón... para poder contar donde caen los dados y las recompensas. Al bot déjale 2 o 3 segundos
// nada más" - leave a 20-second gap between each pawn's own movement, to be able to count where
// the dice land and the rewards; for the bot, leave just 2 or 3 seconds): ALERT_HOLD_MS/
// DICE_DISPLAY_HOLD_MS above were already bumped once for the same class of complaint, but both
// are flat constants applied identically regardless of whose turn produced the value - fine for a
// bot (2-2.8s already lands in the client's own stated "2 o 3 segundos" range, matching
// botController.ts's own BOT_THINK_DELAY_MS pacing, so nothing changes there), nowhere near enough
// for a real person told explicitly to leave 20 seconds. Only wired up for local play (see
// isLocalGame below) - online's own pacing was addressed separately (RemoteTurnManager.ts) and
// this ask, read in full, is specifically about a shared local device ("el juego local").
const HUMAN_REVEAL_HOLD_MS = 20_000

/** A local game builds this via beginLocalGame (src/core/gameFlow/localGameSession.ts); an online
 * game builds it from a HostTurnManagerBridge/RemoteTurnManager (src/online/) plus the players
 * assigned to that room's seats - this screen only ever depends on the TurnManagerLike surface,
 * not which kind of session produced it. */
export interface GameSession {
  turnManager: TurnManagerLike
  players: PlayerState[]
  /** Only set for vs-bots sessions with at least one bot seat (local: localGameSession.ts's own
   * beginLocalGame; online: OnlineLobbyScreen's own botControllerRef) - the piece a bot has just
   * decided to move, so it can carry the same selectable-piece indicator a human's own choosable
   * piece already gets (see BotController's own pieceHighlighted doc comment for why). */
  botPieceHighlighted?: Listenable<Piece | null>
  /** Set by local play (beginLocalGame always runs this pre-game roll-off - see startingPlayer.ts)
   * and, since the online roll-off shipped, by online play too (OnlineLobbyScreen's own
   * startGame()/startAsRemote()) - shown once via StartingPlayerModal on mount, after colorDraw's
   * own modal (if present) is dismissed. */
  startingPlayerResult?: StartingPlayerResult
  /** turnManager.start() (the call that actually activates the game: emits turnStarted, which in
   * vs-bots mode is what schedules a bot's own first roll) is deliberately *not* already called by
   * the time this session exists, for local play (beginLocalGame's own doc comment) and online
   * play alike (OnlineLobbyScreen's own startGame()/startAsRemote()) - StartingPlayerModal's own
   * onDone handler below calls it once the roll-off's reveal actually finishes, not before.
   * Reported directly, for online specifically: dice were already rolling and a piece already
   * moving by the time the local screen even showed who started - bridge.start()/remote.start()
   * used to run immediately in OnlineLobbyScreen.tsx, well before this same reveal. Every session
   * sets this now; nothing currently constructs one without it. */
  deferredStart?: true
  /** Only set for online games (OnlineLobbyScreen's own shuffleColorsByActorNr) - local play never
   * randomizes color, see ColorSelector's own "the player must be able to choose" requirement.
   * Shown once via ColorDrawModal on mount, before startingPlayerResult's own modal. */
  colorDraw?: ColorDrawEntry[]
  /** See LocalGameSession's own doc comment (src/core/gameFlow/localGameSession.ts) - only set for
   * a local vs-bots session. Undefined for classic hotseat (nothing to freeze) and for every online
   * session (pausing one player's own screen can't pause a shared network game for everyone else in
   * the room - Pause is a local-play-only feature, see the Pause button's own doc comment below). */
  pauseBots?: () => void
  resumeBots?: () => void
  /** Set once per real player who leaves an online room mid-game (OnlineLobbyScreen's own
   * onActorLeft handler, both for an ordinary departed seat and a departed Master alike - Photon
   * fires onActorLeft on every surviving client either way). Reported directly, with screenshots
   * showing one side already back at the main menu while the other side's game just kept going
   * with no acknowledgment anything happened: the game correctly keeps running (BotController.
   * takeOverColor hands the departed seat to a bot instead of ending the match for everyone), but
   * that handoff had no on-screen notice at all - silently correct, but reads as "is this stuck?"
   * to whoever's still there. A fresh {color, id} each time (not just color) so the same color
   * leaving and rejoining twice still remounts PlayerLeftToast's own pop-in the second time.
   * Undefined for local play, which has no room to leave. */
  departedPlayerNotice?: { color: PieceColor; id: number }
}

export function GameBoardScreen({
  definition,
  session,
  onExit,
}: {
  definition: BoardDefinition
  session: GameSession
  onExit: () => void
}) {
  // A live game (turns, dice, positions) is real in-progress state a stray click shouldn't be able
  // to throw away - confirm before actually leaving instead of exiting immediately on one click.
  const [confirmingExit, setConfirmingExit] = useState(false)
  // Reported directly, with a screenshot pointing at the exit button's own corner: no way to check
  // the rules mid-game without leaving. Doesn't pause anything - the game clock/turn state (there
  // isn't one to pause anyway; it's all synchronous) keeps running underneath exactly like the exit
  // confirmation dialog already does.
  const [showingHelp, setShowingHelp] = useState(false)
  // Requested directly ("음악을 넣어야겠는데... 3개옵션으로 노래를 선택할수잇게 해달라... 말들을
  // 움직일때의 소리도 3가지로" - add music, let people choose from 3 song options, and also give
  // the piece-movement sound 3 different options): both preferences already existed as functions
  // (introMusic.ts, hopSound.ts) but were only ever reachable from StartScreen's own settings
  // panel, before a game had even started - this mirrors that same row-of-buttons panel here so a
  // player can actually change either one mid-game, which is when "노래를 고를수잇도록" (being able
  // to pick a song) and hearing the result of a hop-sound choice actually matters.
  const [showingSoundSettings, setShowingSoundSettings] = useState(false)
  const [musicMuted, setMusicMuted] = useState(isMusicMuted)
  const [trackIndex, setTrackIndex] = useState(getSelectedTrackIndex)
  const [hopSoundIndex, setHopSoundIndex] = useState(getSelectedHopSoundIndex)
  // See GameSession's own startingPlayerResult doc comment - shown exactly once, right when this
  // screen first mounts for a local game; undefined session.startingPlayerResult (online play)
  // just means this never becomes true at all. Not reset on a later re-render even if the prop
  // reference changes - a fresh game always remounts this whole screen (App.tsx's own key/session
  // rebuild on playerCount/humanColor change), so there's no case where this needs to fire twice
  // for the same still-mounted screen.
  // See GameSession's own colorDraw doc comment - shown before showingStartingPlayer's own modal
  // (below), only ever true for an online game. Undefined session.colorDraw (local play) just
  // means this never becomes true, so showingStartingPlayer's own modal (if any) shows immediately
  // instead, exactly the pre-existing local-play behavior.
  const [showingColorDraw, setShowingColorDraw] = useState(session.colorDraw !== undefined)
  const [showingStartingPlayer, setShowingStartingPlayer] = useState(session.startingPlayerResult !== undefined)
  const {
    currentPlayer,
    lastRoll,
    rolling,
    pendingMoves,
    winner,
    moveAnimation,
    parkillerAnimation,
    diceSettledAt,
    captureFlightPending,
    eliminatedByDoubles: rawEliminatedByDoubles,
    pendingReward,
    forfeitedReward,
    noMoveReason,
    turnEndingSoon,
    rollDice,
    chooseMove,
    clearMoveAnimation,
    clearParkillerAnimation,
  } = useTurnManager(session.turnManager)

  // Reported directly, from a real two-player online test: a player could click "roll" (or a
  // board piece) during someone else's turn - the Master correctly rejects the resulting network
  // intent, but the *clicking* player's own UI had no way to know that, and worse, a rejected roll
  // never fires the diceRolled event that clears useTurnManager's own `rolling` flag, so that
  // player's roll button got stuck disabled/spinning for the rest of the game. `localPlayerColor`
  // is undefined for local pass-and-play (one shared device controls every color, so there's
  // nothing to restrict) and set to this client's own seat color for online play - see
  // TurnManagerLike's own doc comment.
  const localColor = session.turnManager.localPlayerColor
  const isMyTurn = localColor == null || localColor === currentPlayer.color

  // See HUMAN_REVEAL_HOLD_MS's own doc comment - this used to read session.deferredStart, on the
  // premise that it was only ever set by beginLocalGame. That stopped being true once online's own
  // color-draw-reveal-ordering fix (see GameSession's own deferredStart doc comment) made
  // OnlineLobbyScreen.tsx's startAsRemote()/startGame() start setting deferredStart: true as well,
  // to hold off turnManager.start() for the reveal there too - deferredStart has been true for
  // every session, local and online alike, ever since, so it could no longer tell them apart.
  //
  // Found via a real online-room recording: a static "TURNO DE BLUE / Elija una ficha para mover"
  // moment was followed ~10.5s later by the "¿Sigue ahí?" idle warning firing with a 10-count
  // countdown and the local-only "Se jugará este turno en su lugar por inactividad" copy - both
  // exactly the *local* IDLE_WARNING_MS/COUNTDOWN_S pacing and copy, not online's - and the Pause
  // button (documented below as local-only) was rendering online too. All three trace back to this
  // same isLocalGame always evaluating true. Worse than a cosmetic mismatch: with isLocalGame stuck
  // true, the autoPlayIdleTurn effect further below no longer bails out for online (its
  // `if (!isLocalGame) return` guard never returns), so it silently rolls dice and picks a move on
  // an online player's behalf after the (wrongly short) countdown - exactly what online was designed
  // never to do (see that effect's own doc comment).
  //
  // session.colorDraw is the reliable discriminator instead: set unconditionally by both online
  // session-construction sites (OnlineLobbyScreen.tsx's startAsRemote()/startGame()) and never set
  // by local play (localGameSession.ts's own beginLocalGame never populates it - see ColorSelector's
  // own "the player must be able to choose" requirement, colorDraw's own doc comment above).
  const isLocalGame = session.colorDraw === undefined
  // `color` is whichever player's turn produced the value being held - eliminatedByDoubles/
  // pendingReward/forfeitedReward/lastRoll are all set (and held) *before* any turn-ending
  // transition can move currentPlayer on to someone else (a pending reward or an unresolved
  // "which piece do I move" choice both block the turn from ending at all - see turnManager.ts's
  // own PENDING_REWARD handling; a forfeit is resolved mid-turn for the same reason, well before
  // any handoff - see useTurnManager.ts's own rewardForfeited comment), so currentPlayer.color is
  // still correct for this at the point each of this hook's own useHeldAlert calls below first
  // captures a fresh value.
  function holdMsFor(defaultMs: number, color: PieceColor): number {
    if (!isLocalGame) return defaultMs
    const isBotTurn = localColor != null && color !== localColor
    return isBotTurn ? defaultMs : HUMAN_REVEAL_HOLD_MS
  }

  // Moved up from further below (animationsSettled's own declaration used to come after this
  // point) - eliminatedByDoubles' own animation-gating fix, right below, needs it here; every other
  // consumer already just reads it as a plain derived value with no ordering dependency of its own.
  //
  // Reported directly ("no ha manera de hacer coincidir... el sonido de comer va por delante de la
  // imagen" - the eating sound goes ahead of the image): moveAnimation/parkillerAnimation/
  // captureFlightPending - see this const's own reasoning just below.
  const animationsSettled = !moveAnimation && !parkillerAnimation && !captureFlightPending

  // See ALERT_HOLD_MS's own doc comment above - held so a fast-following move can't clear this
  // again before there's been real time to read it.
  //
  // Reported again, directly, still going out of sync ("el sonido de comer... va por delante de la
  // imagen y debe de ir después" - the eating sound goes ahead of the image, and should go after
  // it): this used to feed straight off rawEliminatedByDoubles with no animation gate at all (unlike
  // the reward-based captures/finishes just below, which already wait on animationsSettled) - the
  // penalty (and playCaptureSound, further below, which depends on this same held value) could fire
  // while the move that triggered the third double was still visibly mid-hop. Gated the same way
  // visiblePendingReward/visibleForfeitedReward already are.
  const eliminatedByDoubles = useHeldAlert(
    animationsSettled ? rawEliminatedByDoubles : null,
    holdMsFor(ALERT_HOLD_MS, rawEliminatedByDoubles?.color ?? currentPlayer.color),
  )

  // See GameSession's own botPieceHighlighted doc comment - undefined for hotseat play and for any
  // session with no bot seats at all, in which case this just stays null forever, same as if no
  // piece were ever highlighted.
  const [botHighlightedPiece, setBotHighlightedPiece] = useState<Piece | null>(null)
  useEffect(() => {
    setBotHighlightedPiece(null)
    return session.botPieceHighlighted?.on((piece) => setBotHighlightedPiece(piece))
  }, [session.botPieceHighlighted])

  // Reported directly ("차례차례대로... 앞장지르는 일이없도록"): the next move's piece choices and any
  // reward it earned were exposed the instant the underlying events fired - the same synchronous
  // tick the capturing/finishing move's own hop animation started, not once it actually finished
  // arriving. TurnManager itself never waits on animation (game state always advances the instant a
  // move is submitted - only the visual playback takes time, same as the capture-visual gating
  // above), so this hook's raw pendingMoves/pendingReward/forfeitedReward already reflect the next
  // real choice well before the board has caught up - gating what's actually shown/interactive on
  // both animations having cleared (animationsSettled, moved up above) keeps everything landing in
  // the order it visually happened.
  // !turnEndingSoon: while a barrier-locked (or otherwise move-not-possible) roll's own
  // "explanation, then advance" hold is playing out (see useTurnManager's own TURN_CHANGE_HOLD_MS),
  // currentPlayer/pendingMoves haven't visibly changed yet, so canRoll's other conditions alone
  // would let the roller click again mid-hold - the real TurnManager has already moved on
  // internally by that point, so a second roll here would land on the wrong player's turn.
  // Requested directly ("로컬 게임에는 Pause 기능을 넣어라" - add a Pause feature to local games):
  // blocks the roll button and piece clicks below (same as any other canRoll/visiblePendingMoves
  // gate already does for "not your turn"), and freezes whichever bots are mid-turn via
  // session.pauseBots - see that field's own doc comment. Only ever toggled by the Pause button
  // itself (topRightButtonRowStyle below), which only renders for isLocalGame - staying false
  // forever for online play, where one player's own screen has no business freezing anyone else's.
  const [paused, setPaused] = useState(false)
  function togglePause() {
    setPaused((wasPaused) => {
      const nowPaused = !wasPaused
      if (nowPaused) session.pauseBots?.()
      else session.resumeBots?.()
      return nowPaused
    })
  }

  // See computeAnimationsSettledForPendingMoves's own doc comment above for the exact bug this
  // fixes - canRoll/awaitingPieceChoice/visiblePendingMoves (below) all used to read the raw
  // `animationsSettled` directly, so a later captureFlightPending retrigger off some EARLIER,
  // unrelated capture's own trailing edge kept re-collapsing an already-revealed pendingMoves
  // choice/roll opportunity. Threaded through a ref, same pattern captureFlightHoldRef
  // (useTurnManager.ts) already uses for its own plain, non-React state class.
  const pendingMovesSettledRef = useRef<{ pendingMoves: MoveOption[]; settled: boolean } | undefined>(undefined)
  pendingMovesSettledRef.current = computeAnimationsSettledForPendingMoves(pendingMovesSettledRef.current, pendingMoves, animationsSettled)
  const animationsSettledForPendingMoves = pendingMovesSettledRef.current.settled

  const canRoll = isMyTurn && pendingMoves.length === 0 && !winner && !rolling && !turnEndingSoon && animationsSettledForPendingMoves && !paused
  // Same conditions as canRoll, but for the *other* half of a human's own turn - already rolled,
  // still needs to pick which piece to move. canRoll alone (the only thing the idle timers below
  // used to watch) left this half of a turn with no idle coverage at all. Reads the raw
  // `pendingMoves` rather than the visiblePendingMoves declared further below (same isMyTurn/
  // animationsSettledForPendingMoves gating either way, just declared before this point instead of
  // after it).
  const awaitingPieceChoice =
    isMyTurn && !winner && !rolling && !turnEndingSoon && animationsSettledForPendingMoves && !paused && pendingMoves.length > 0

  // Idle nudge: reported directly - a player who steps away or just spaces out mid-turn leaves
  // everyone else staring at a board that never visibly asks for input. Restarts whenever canRoll
  // flips (a fresh chance to roll appeared, or this one just got used/left) or the turn itself
  // changes, so it can't fire mid-roll or carry over onto the next player's turn.
  //
  // Reported directly, for local play specifically ("TE ECHA FUERA CON SOLO 10 SEGUNDOS DE
  // INACTIVIDAD... el paso al bot siguiente al cabo de 20 segundos de inactividad" - kicks you out
  // after only 10 seconds of inactivity; there should be a pass to the next [player/bot] after 20
  // seconds of inactivity): online's own 60s-nudge/90s-warning/20s-countdown pacing (110s total) was
  // never meant for local play, which has no network/room lifecycle to protect at all - only ever
  // tuned for how long a real multiplayer room should tolerate someone going quiet. Local gets a
  // much tighter, and *enforced*, 20-second budget instead: an 8-second nudge, then a 10-second
  // countdown that actually plays the idle turn out (autoPlayIdleTurn below) rather than just
  // sitting there forever the way online's own countdown deliberately still does (nothing else in
  // this app can rejoin a local player the way reconnectAndRejoin covers an online drop, so there's
  // no equivalent "wait for them to come back" option to fall back to here).
  const IDLE_NUDGE_MS = isLocalGame ? 8_000 : 60_000
  const [nudgeDice, setNudgeDice] = useState(false)

  const IDLE_WARNING_MS = isLocalGame ? 10_000 : 90_000
  const IDLE_WARNING_COUNTDOWN_S = isLocalGame ? 10 : 20
  const [idleWarningSecondsLeft, setIdleWarningSecondsLeft] = useState<number | null>(null)
  const [idleResetToken, setIdleResetToken] = useState(0)

  // Reported directly, via a full audit: neither canRoll/awaitingPieceChoice above nor this flag
  // ever checked showingHelp/showingSoundSettings/confirmingExit - only !paused - so opening any of
  // those three dialogs and leaving it open (perfectly normal: reading the rules, picking a song,
  // deciding whether to exit) let the idle nudge/warning/auto-play sequence keep running right
  // underneath it. The warning overlay's own z-index (40) sits above all three dialogs, so once it
  // appeared it visually covered whichever one was open and swallowed clicks meant for it; worse,
  // once the countdown reached 0, autoPlayIdleTurn() actually rolled the dice/picked a move on the
  // player's behalf while they were still reading. Unlike the Pause button (which deliberately
  // freezes everything - see its own doc comment on why Help/exit-confirm do NOT pause anything),
  // a player who just opened one of these dialogs is plainly still there; gating on all three here
  // means opening one always fully clears any in-progress warning (the effect below resets it
  // whenever idleTriggerActive itself changes) and gives a completely fresh idle window once it's
  // closed, rather than the countdown continuing to run - or firing - underneath it. Pulled out as
  // its own pure function (see computeAwaitingMoveChoice's own doc comment just above for this
  // file's established reasoning) so this exact gating has a test - see
  // tests/gameBoardIdleTriggerActive.test.ts.
  const idleTriggerActive = computeIdleTriggerActive({ canRoll, awaitingPieceChoice, showingHelp, showingSoundSettings, confirmingExit })

  useEffect(() => {
    setNudgeDice(false)
    setIdleWarningSecondsLeft(null)
    if (!idleTriggerActive) return
    const nudgeTimer = setTimeout(() => setNudgeDice(true), IDLE_NUDGE_MS)
    const warningTimer = setTimeout(() => setIdleWarningSecondsLeft(IDLE_WARNING_COUNTDOWN_S), IDLE_WARNING_MS)
    return () => {
      clearTimeout(nudgeTimer)
      clearTimeout(warningTimer)
    }
  }, [idleTriggerActive, currentPlayer.color, idleResetToken])

  // Ticks the on-screen countdown down to 0 once the warning above has appeared. Online: no
  // explicit request to force any auto-skip/kick action once it hits zero, so it stays up (still
  // dismissible by the same click-anywhere handler) rather than doing anything drastic. Local: the
  // separate effect just below actually acts once this reaches 0.
  useEffect(() => {
    if (idleWarningSecondsLeft === null || idleWarningSecondsLeft <= 0) return
    const timer = setTimeout(() => setIdleWarningSecondsLeft((seconds) => (seconds === null ? null : seconds - 1)), 1000)
    return () => clearTimeout(timer)
  }, [idleWarningSecondsLeft])

  const dismissIdleWarning = () => setIdleResetToken((token) => token + 1)

  // "el paso al bot siguiente al cabo de 20 segundos de inactividad" - pass to the next player
  // after 20 seconds of inactivity. Parchís has no "pass without rolling" move to fall back on, so
  // this plays the idle turn out with the simplest available choice instead - a real roll and a
  // real (if unconsidered) move, exactly the same "first option" fallback botController.ts itself
  // uses when nothing smarter applies - rather than literally skipping the human's own turn.
  function autoPlayIdleTurn(): void {
    if (pieceChoice) {
      confirmPieceChoice(pieceChoice.options[0].amount)
      return
    }
    if (visiblePendingMoves.length > 0) {
      const first = visiblePendingMoves[0]
      chooseMove(first.piece, first.amount)
      return
    }
    if (canRoll) rollDice()
  }

  useEffect(() => {
    if (!isLocalGame) return
    if (idleWarningSecondsLeft !== 0) return
    autoPlayIdleTurn()
    dismissIdleWarning()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocalGame, idleWarningSecondsLeft])

  // See DICE_DISPLAY_HOLD_MS's own doc comment above - holds the last roll's numbers on screen for
  // a minimum viewing window instead of blanking the instant the turn moves on. Shows a fresh roll
  // immediately once its own spin/reveal actually completes, same as the reward/elimination toasts.
  //
  // Reported directly ("아직 다 이동하지도 않고 이동하려고 하는 참인데 왜 벌써 주사위는 제자리로
  // 돌아가..." - the dice reset before the piece has even finished moving): held for the whole
  // roll, not just a fixed window after the reveal, and never cleared while a piece is still
  // hopping - see heldAlertTiming.ts for both causes.
  const visibleRoll = useHeldAlert(lastRoll, holdMsFor(DICE_DISPLAY_HOLD_MS, currentPlayer.color), {
    ceiling: false,
    blockClear: !animationsSettled,
    lingerMs: DICE_POST_MOVE_LINGER_MS,
  })
  const diceValues: [number | null, number | null, number | null] = [
    visibleRoll?.dieA ?? null,
    visibleRoll?.dieB ?? null,
    visibleRoll?.blackDie ?? null,
  ]
  const isDouble = visibleRoll !== null && visibleRoll.dieA === visibleRoll.dieB

  // Bug found by close video review of a real local recording (b3_0131.jpg): right as a bot's roll
  // that left it with zero legal moves handed the turn straight to the next (different) player,
  // that next player's freshly-flipped "TURNO DE X" header showed the *previous* player's own
  // "Dados: A y B · Parkiller: C" numbers for about two seconds before collapsing to the correct
  // "Tire los dados para empezar su turno" prompt - despite no piece anywhere on the board actually
  // moving in that window. Root cause: turnManager.ts's own requestRoll fires diceRolled,
  // moveNotPossible('none') and turnStarted(nextPlayer) all synchronously on that kind of forfeited
  // roll (see turnManager.ts around its own PENDING_REWARD/no-legal-move handling), so
  // useTurnManager.ts arms two *independent* timers off that same instant: DICE_SPIN_MS (2000ms)
  // later, diceRolled's own handler sets the real `lastRoll` (still the forfeiting player's own
  // roll, since currentPlayer hasn't flipped yet); TURN_CHANGE_HOLD_MS (3000ms) later, turnStarted's
  // different-player branch flips currentPlayer to the next player and nulls the underlying
  // lastRoll. visibleRoll (useHeldAlert, just above) captures its hold window at the *first* of
  // those two instants - while currentPlayer is still the forfeiting player - so by the time
  // currentPlayer flips a second later, visibleRoll's own hold clock (holdMsFor's short bot pacing,
  // captured before the flip) still has time left on it and keeps returning that stale roll, now
  // rendered under the new player's header. A normal (non-forfeited) bot move takes long enough for
  // the hold to have already expired by the time the handoff completes, which is why this only
  // surfaces on an immediately-forfeited roll.
  //
  // Fixed by tracking whose turn a given lastRoll actually belongs to - captured at the exact
  // instant it first goes non-null, which (per the timing above) is always still that roller's own
  // turn for both this handoff case and the ordinary same-player-bonus case - and refusing to show
  // visibleRoll's numbers under any *other* player's header, however much of its own display hold
  // is still left.
  const rollOwnerRef = useRef<PieceColor | null>(null)
  useEffect(() => {
    if (lastRoll) rollOwnerRef.current = currentPlayer.color
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRoll])
  // Exported as its own pure function, same reasoning as computeAwaitingRewardChoice/
  // computeAwaitingMoveChoice/computeRollPromptStatusLine above: this component has no
  // React-rendering test infra, so tests/turnRollOwnership.test.ts exercises this gating directly
  // instead. Returns visibleRoll unchanged when it's genuinely still the current player's own roll
  // (the ordinary case, every render outside the handoff-race window above), null otherwise so the
  // ternary below falls through to computeRollPromptStatusLine instead of showing someone else's
  // numbers.
  const rollToShow = computeVisibleRollForOwner({
    visibleRoll,
    rolling,
    rollOwnerColor: rollOwnerRef.current,
    currentPlayerColor: currentPlayer.color,
  })

  // Only the current turn's own piece choices are ever meant to be actionable - every online
  // client replays the same broadcast dice roll locally (see MoveAnimationInfo's own comment), so
  // pendingMoves gets populated identically on every client regardless of whose turn it actually
  // is. Without this gate, a piece would glow as selectable (and be clickable) on a client whose
  // turn it isn't - the Master would reject the resulting move intent, but the clicking player's
  // own board never should have offered it in the first place.
  //
  // Reported directly, with a screenshot: pieces were already glowing/bouncing as selectable while
  // the dice (specifically the black Parkiller die) were still visibly spinning - "오락의 모든과정은
  // 하나씩 차례대로 진행되여야한다" (every step of the game should happen one at a time, in order).
  // Root cause: TurnManager's own moveChoicesReady event fires synchronously as part of resolving
  // the roll, well before the dice-spin's own cosmetic reveal animation (DICE_SPIN_MS,
  // useTurnManager.ts) has actually finished - useTurnManager.ts's own `rolling` flag exists
  // specifically to track that window, and awaitingPieceChoice (this file, driving the "Elija una
  // ficha" text prompt) already correctly waits on it - this value, driving every piece's own
  // `selectable` prop instead, was the one place that check got missed.
  //
  // Reads animationsSettledForPendingMoves (not the raw animationsSettled) - see
  // computeAnimationsSettledForPendingMoves's own doc comment above: a fresh pendingMoves value
  // still has to wait for a genuine settle here, same as always, but an already-revealed one no
  // longer gets re-masked by a later, unrelated captureFlightPending retrigger.
  const visiblePendingMoves = isMyTurn && !rolling && animationsSettledForPendingMoves && !paused ? pendingMoves : []
  // See ALERT_HOLD_MS's own doc comment above - held so a fast-following move can't clear these
  // again before there's been real time to read them.
  const visiblePendingReward = useHeldAlert(animationsSettled ? pendingReward : null, holdMsFor(ALERT_HOLD_MS, currentPlayer.color))
  const visibleForfeitedReward = useHeldAlert(animationsSettled ? forfeitedReward : null, holdMsFor(ALERT_HOLD_MS, currentPlayer.color))
  // Immediate, animation-gated - unlike visiblePendingReward just above (deliberately held via
  // useHeldAlert so RewardToast/RewardBurst get their own longer visibility window, see
  // useHeldAlert's own doc comment), the turn-status text below must stop saying "choose a piece
  // for your reward" the instant the player actually picks one, even though that pick's own
  // reward-move animation keeps visiblePendingReward (and so the toast/burst) alive for a while
  // longer. Reported directly from a real local recording: the header stayed frozen on "Elija una
  // ficha para su recompensa" for the whole ~10-12s the chosen reward piece was visibly hopping
  // forward, because the header was reading visiblePendingReward instead of the raw, ungated
  // pendingReward - mirrors how visiblePendingMoves above already tracks live state with no hold.
  // Pulled out into its own exported, pure function (rather than inlined like visiblePendingMoves
  // just above) purely so it has a testable seam - this component has no React-rendering test
  // infra, so tests/gameBoardRewardStatus.test.ts exercises this gating directly instead.
  const awaitingRewardChoice = computeAwaitingRewardChoice({ isMyTurn, rolling, animationsSettled, paused, pendingReward })
  // See computeAwaitingMoveChoice's own doc comment above - the turn-status header's live,
  // unheld snapshot of "is a piece choice still open right now", deliberately not gated on
  // animationsSettled the way visiblePendingMoves (piece selectability) is.
  const awaitingMoveChoice = computeAwaitingMoveChoice({ isMyTurn, rolling, paused, pendingMoves })

  // Requested directly ("cuando se elimina a un peón o un peón llega a la meta debe haber alguna
  // celebración con música"): every capture (a regular pawn's own move, or a Parki eliminating an
  // opposing Parki - PK6/PK7) always queues a reward grant (PC5) - reason 'capture' for the former,
  // 'parkillerCapture' for the latter (split into its own reason so RewardToast/RewardBurst can
  // finally tell the two apart - see RewardReason's own doc comment in turnManager.ts) - and a
  // finished piece always queues one too, reason 'finish'. Both capture-flavored reasons still play
  // the exact same fanfare here (only the *visual* toast/burst treatment differs) - so watching
  // *either* the pendingReward or the forfeitedReward on this same reward exactly matches "a
  // capture/finish just happened", regardless of whether the resulting bonus itself could actually
  // be spent. Gated on the already-animation-settled visible* versions (not the raw pendingReward/
  // forfeitedReward), so this fires at the same moment RewardToast/RewardBurst reveal themselves,
  // not the instant the underlying game state updates well before the capturing piece's own hop has
  // visually landed.
  useEffect(() => {
    const grant = visiblePendingReward ?? visibleForfeitedReward
    if (!grant) return
    if (grant.reason === 'capture' || grant.reason === 'parkillerCapture') playCaptureFanfare()
    else playFinishSound()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePendingReward, visibleForfeitedReward])

  // PK5: a Parki landing on an opposing *pawn* (not another Parki) sends it home with no reward at
  // all (turnManager.ts's own resolveParkillerCollisions) - the one capture shape the reward-based
  // effect above can never see, since nothing gets queued for it, and (until this fix) the only one
  // with no toast of its own either - EliminationToast only ever covered the doubles-penalty case
  // below.
  //
  // Reported directly ("el sonido de comer... va por delante de la imagen y debe de ir después" -
  // the eating sound goes ahead of the image, it should go after; earlier, separately: "DEBE HABER
  // ALGO ESPECIAL CUANDO...EL PARKI ELIMINA A UN PEON" - there should be something special when the
  // Parki eliminates a pawn): parkillerAnimation.capturedPawn is only ever set for the duration of
  // the Parki's *own* hop - it clears the instant that hop lands, well before the captured pawn's
  // own separate "flung home" bounce (captureFlightPending, useTurnManager.ts) has even started, let
  // alone finished. Playing the sound straight off it fired while the Parki was still visibly
  // mid-hop, sound well ahead of the pawn's own trip home. Remembers the captured piece the instant
  // it's seen, then waits for animationsSettled - which already accounts for that same bounce, same
  // as the reward-based capture effect above - before actually surfacing either the sound or the
  // toast (parkillerVictim, rendered further below alongside EliminationToast's other instance).
  const pendingParkillerVictimRef = useRef<Piece | null>(null)
  useEffect(() => {
    if (parkillerAnimation?.capturedPawn) pendingParkillerVictimRef.current = parkillerAnimation.capturedPawn
  }, [parkillerAnimation])
  const [parkillerVictim, setParkillerVictim] = useState<Piece | null>(null)
  useEffect(() => {
    if (!animationsSettled || !pendingParkillerVictimRef.current) return
    const victim = pendingParkillerVictimRef.current
    pendingParkillerVictimRef.current = null
    playCaptureFanfare()
    setParkillerVictim(victim)
    const timer = setTimeout(() => setParkillerVictim(null), holdMsFor(ALERT_HOLD_MS, currentPlayer.color))
    // Reported directly, with a screenshot: the card stayed on screen indefinitely ("없어지지 않고
    // 계속 유지된다" - doesn't go away, stays there permanently). Root cause: this effect only
    // depends on animationsSettled, so if it flips back to false again (a new roll/move starting)
    // before this timer's own holdMs elapses, React runs this cleanup - clearTimeout(timer) alone -
    // and the effect body then bails out immediately on its own next invocation (animationsSettled
    // is false), never arming a replacement. Nothing was left to ever clear parkillerVictim again,
    // for the rest of the game. Clearing it right here too - not just the timer - means a fresh
    // animation starting always supersedes a still-showing card instead of orphaning it.
    return () => {
      clearTimeout(timer)
      setParkillerVictim(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animationsSettled])

  // Reported directly, again ("ELIMINA SIN QUE HAYA SIGNO NI CELEBRACION NI SONIDO ESPECIAL...
  // DEBE HABER ALGO ESPECIAL CUANDO UN PEON O EL PARKI ELIMINA A UN PEON" - it eliminates with no
  // sign, no celebration, no special sound at all - there should be something special whenever a
  // pawn or the Parki eliminates a pawn): the two effects above already cover exactly those two
  // cases (an ordinary capture via the reward it grants; a Parki eating a pawn directly), but a
  // third, separate way a piece gets sent home - rolling three doubles in a row (PK3) - was missed
  // by both: it grants no reward at all (nothing for the first effect to see) and isn't a Parki
  // eating a pawn either (nothing for the second). EliminationToast already shows something for
  // this case, but silently - no sound at all, exactly the reported gap.
  useEffect(() => {
    if (eliminatedByDoubles) playCaptureSound()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eliminatedByDoubles])

  // Pairs a sound with the existing Confetti visual (below) for the game's own final celebration -
  // client's own original prototype plays sound_partida_finalizada alongside its win banner too
  // (obj_cartel_ganaste/Create_0.gml).
  useEffect(() => {
    if (winner) playGameWonSound()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winner])

  // Reported directly ("SE DEBE PODER ELEGIR CON CUAL DE LOS DOS DADOS SE MUEVE EL PEON QUE SE
  // DESEE"): a piece reachable by both dice (to two different squares) used to just move by
  // whichever die TurnManager happened to check first, with no way to pick the other - clicking a
  // piece now only moves it immediately when there's exactly one legal option; with two or more
  // (see turnManager.ts's own offerMoves, which keeps every distinct amount instead of collapsing
  // to one per piece), this holds the choice open until the player picks one.
  const [pieceChoice, setPieceChoice] = useState<{ piece: Piece; options: MoveOption[] } | null>(null)
  useEffect(() => {
    setPieceChoice(null)
  }, [pendingMoves])

  function handleSelectPiece(piece: Piece) {
    if (paused) return
    // Clicking the same piece a choice is already open for backs out of it - the only "cancel"
    // affordance for the floating markers (see BoardScene's own PieceChoiceMarkers), since there's
    // no dialog chrome here to put a Cancelar button on.
    if (pieceChoice?.piece === piece) {
      setPieceChoice(null)
      return
    }
    const options = visiblePendingMoves.filter((m) => m.piece === piece)
    if (options.length <= 1) {
      chooseMove(piece, options[0]?.amount)
      return
    }
    setPieceChoice({ piece, options })
  }

  function confirmPieceChoice(amount: number) {
    if (!pieceChoice) return
    chooseMove(pieceChoice.piece, amount)
    setPieceChoice(null)
  }

  // See computeBotStatusLine's own doc comment above - what the subtitle says during a bot's turn
  // (isLocalGame && !isMyTurn), instead of the generic online-only "Esperando..." placeholder.
  // Passes rollToShow, not the raw visibleRoll - same reasoning as rollToShow's own doc comment
  // just above and its use in the human-facing branch further below: a still-held visibleRoll can
  // briefly belong to the *previous* player's own immediately-forfeited roll right as the handoff
  // to this (possibly bot-owned) turn completes, and this branch must not narrate that stale roll
  // as if it were this player's own.
  const botStatusLine = computeBotStatusLine({
    isLocalGame,
    rolling,
    animationsSettled,
    pendingReward,
    pendingMoves,
    visibleRoll: rollToShow,
    isDouble,
    currentPlayerColor: currentPlayer.color,
  })

  // What the turn banner's subtitle says - one place for this instead of scattering the same
  // priority order (doubles warning > not-my-turn > reward > move prompt > roll prompt) across
  // JSX conditionals.
  // Reported directly (Carlos: "Cuando hay una barrera no se quieren mover ninguno de los dos
  // peones... no ha manera" - stuck at a barrier with seemingly no way out at all): a roll that
  // forfeits the turn outright used to fall straight through to the default "Dados: X y Y" line
  // with zero explanation of why nothing happened, indistinguishable from a silent freeze. Gated
  // on !rolling so it only appears once the dice themselves have finished revealing (noMoveReason
  // is set well before that, see useTurnManager's own TURN_CHANGE_HOLD_MS comment for why) - showing
  // this text while the dice are still visibly spinning would read as answering a question the
  // player hasn't even been shown yet.
  const statusLine = paused
    ? 'Partida en pausa'
    : eliminatedByDoubles
    ? `Tercer dobles seguido: ${eliminatedByDoubles.color} pierde una ficha`
    : !isMyTurn
      ? botStatusLine
      : noMoveReason && !rolling
        ? 'Ningún movimiento posible con esta tirada'
        : pieceChoice
          ? 'Elija con qué dado moverla'
          : awaitingRewardChoice
            ? 'Elija una ficha para su recompensa'
            // See computeAwaitingMoveChoice's own doc comment above (b2_0248.jpg) - reads the raw,
            // unheld awaitingMoveChoice rather than the animation-gated visiblePendingMoves, so a
            // momentary rolling/animationsSettled blip can't flicker this text away for a tick.
            : awaitingMoveChoice.length > 0
              ? 'Elija una ficha para mover'
              // See rollToShow's own doc comment above (b3_0131.jpg) - without the ownership check
              // it applies, a still-held visibleRoll left over from the *previous* player's
              // immediately-forfeited roll could keep showing that player's own numbers for a
              // moment under this (new) player's freshly-flipped header.
              : rollToShow
                ? `Dados: ${rollToShow.dieA} y ${rollToShow.dieB}${isDouble ? ' (dobles)' : ''} · Parkiller: ${rollToShow.blackDie}`
                : computeRollPromptStatusLine({ canRoll })

  return (
    <div className="game-screen-in" style={screenWrapperStyle}>
      <BoardScene
        definition={definition}
        players={session.players}
        pendingMoves={visiblePendingMoves}
        onSelectPiece={handleSelectPiece}
        currentPlayerColor={currentPlayer.color}
        diceValues={diceValues}
        rolling={rolling}
        // nudgeDice itself is armed by idleTriggerActive (canRoll || awaitingPieceChoice - see that
        // const's own doc comment above), on purpose: the idle timers need to cover *both* halves of
        // a human's turn so the warning/countdown/autoPlayIdleTurn below still fire while a piece
        // choice is pending, not just pre-roll. But the dice's own bounce visual doesn't share that
        // double duty - it only ever means "roll me". Reported directly, with a screenshot (a white
        // die mid-bounce while a piece was already the pending choice): passing nudgeDice straight
        // through with no further gating made the dice visibly nudge during awaitingPieceChoice too,
        // pointing the player at the wrong element - the dice aren't even clickable then
        // (canRollDice={canRoll} below is already false), and the pieces themselves already carry
        // their own always-on selectable glow/bob for that phase (see PieceMesh.tsx), so they need
        // no extra idle-triggered cue. ANDing with canRoll here scopes the visual back to the one
        // phase it actually applies to, without touching idleTriggerActive/the timers themselves.
        nudgeDice={nudgeDice && canRoll}
        onRollDice={() => canRoll && rollDice()}
        canRollDice={canRoll}
        moveAnimation={moveAnimation}
        onAnimationComplete={clearMoveAnimation}
        parkillerAnimation={parkillerAnimation}
        onParkillerAnimationComplete={clearParkillerAnimation}
        diceSettledAt={diceSettledAt}
        pieceChoice={pieceChoice ? { piece: pieceChoice.piece, amounts: pieceChoice.options.map((o) => o.amount) } : null}
        onChoosePieceAmount={confirmPieceChoice}
        botHighlightedPiece={botHighlightedPiece}
      />

      <div style={frameOverlayStyle} />

      {idleWarningSecondsLeft !== null && !paused && !showingHelp && !showingSoundSettings && !confirmingExit && (
        <div style={idleWarningOverlayStyle} onClick={dismissIdleWarning}>
          <div style={idleWarningCountdownStyle}>{idleWarningSecondsLeft}</div>
          <div style={idleWarningTitleStyle}>¿Sigue ahí?</div>
          {isLocalGame ? (
            <div style={hintTextStyle}>Se jugará este turno en su lugar por inactividad.</div>
          ) : (
            <div style={hintTextStyle}>La partida podría desconectarse por inactividad.</div>
          )}
          <div style={hintTextStyle}>Toque la pantalla para continuar.</div>
        </div>
      )}

      <RewardBurst pendingReward={visiblePendingReward} forfeitedReward={visibleForfeitedReward} />
      <RewardToast pendingReward={visiblePendingReward} forfeitedReward={visibleForfeitedReward} />
      <EliminationToast eliminatedPiece={eliminatedByDoubles} reason="doubles" />
      <EliminationToast eliminatedPiece={parkillerVictim} reason="parkiller" />
      <PlayerLeftToast notice={session.departedPlayerNotice ?? null} />
      <InteractiveCursorOverlay />

      <div style={turnCardStyle}>
        <div style={turnCardHeaderStyle}>
          <span style={{ ...avatarStyle, background: getColor(currentPlayer.color) }}>♟</span>
          <div style={{ minWidth: 0 }}>
            <div style={turnTitleStyle}>TURNO DE {currentPlayer.color.toUpperCase()}</div>
            <div style={turnSubtitleStyle}>{statusLine}</div>
          </div>
        </div>
        <button
          className="chunky-btn"
          onClick={() => canRoll && rollDice()}
          disabled={!canRoll}
          style={cardRollButtonStyle(canRoll, getColor(currentPlayer.color))}
        >
          {rolling ? 'RODANDO...' : 'TIRAR DADOS'}
        </button>
      </div>

      <div style={playerRowStyle}>
        {session.players.map((p) => (
          <PlayerPill key={p.color} player={p} isCurrentTurn={p.color === currentPlayer.color} isLocal={p.color === localColor} />
        ))}
      </div>

      <div style={topRightButtonRowStyle}>
        {isLocalGame && (
          <button className="chunky-btn" onClick={togglePause} title={paused ? 'Reanudar' : 'Pausa'} style={medallionButtonStyle}>
            {paused ? '▶' : '⏸'}
          </button>
        )}

        <button className="chunky-btn" onClick={() => setShowingSoundSettings(true)} title="Sonido" style={medallionButtonStyle}>
          ♪
        </button>

        <button className="chunky-btn" onClick={() => setShowingHelp(true)} title="Cómo se juega" style={medallionButtonStyle}>
          ?
        </button>

        <button className="chunky-btn" onClick={() => setConfirmingExit(true)} title="Salir del juego" style={medallionButtonStyle}>
          ✕
        </button>
      </div>

      {showingHelp && <HelpModal onClose={() => setShowingHelp(false)} />}

      {showingSoundSettings && (
        <div style={overlayStyle}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#f2ede0' }}>Sonido</div>
          <button className="chunky-btn" onClick={() => setMusicMuted(toggleMusicMuted())} style={secondaryButtonStyle}>
            {musicMuted ? 'Música: apagada' : 'Música: encendida'}
          </button>
          <button className="chunky-btn" onClick={() => setTrackIndex(nextMusicTrack())} style={secondaryButtonStyle}>
            {getTrackLabel(trackIndex)}
          </button>
          {/* Immediately plays the newly-picked tick, not just the next real hop - otherwise the
              choice wouldn't actually be heard until this player's next move. */}
          <button
            className="chunky-btn"
            onClick={() => {
              setHopSoundIndex(nextHopSound())
              playHopSound()
            }}
            style={secondaryButtonStyle}
          >
            Sonido de movimiento: {getHopSoundLabel(hopSoundIndex)}
          </button>
          <button className="chunky-btn" onClick={() => setShowingSoundSettings(false)} style={rollButtonStyle(true)}>
            Cerrar
          </button>
        </div>
      )}

      {showingColorDraw && session.colorDraw && (
        <ColorDrawModal
          assignments={session.colorDraw}
          localPlayerColor={session.turnManager.localPlayerColor ?? null}
          onDone={() => setShowingColorDraw(false)}
        />
      )}

      {!showingColorDraw && showingStartingPlayer && session.startingPlayerResult && (
        <StartingPlayerModal
          result={session.startingPlayerResult}
          onDone={() => {
            // See GameSession's own deferredStart doc comment - the game only actually activates
            // now, once the roll-off's own reveal has genuinely finished and the player has
            // dismissed it, not before.
            if (session.deferredStart) session.turnManager.start()
            setShowingStartingPlayer(false)
          }}
        />
      )}

      {paused && !showingColorDraw && !showingStartingPlayer && !confirmingExit && (
        <div style={overlayStyle}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#f2ede0' }}>Pausa</div>
          <div style={hintTextStyle}>El juego está detenido - nadie puede tirar ni mover.</div>
          <button className="chunky-btn" onClick={togglePause} style={rollButtonStyle(true)}>
            Reanudar
          </button>
        </div>
      )}

      {confirmingExit && (
        <div style={overlayStyle}>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#f2ede0' }}>¿Seguro que quiere salir?</div>
          <div style={{ ...hintTextStyle, marginBottom: 4 }}>Se perderá la partida en curso.</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="chunky-btn" onClick={() => setConfirmingExit(false)} style={secondaryButtonStyle}>
              Cancelar
            </button>
            <button className="chunky-btn" onClick={onExit} style={rollButtonStyle(true)}>
              Sí, salir
            </button>
          </div>
        </div>
      )}

      {winner && (
        <div style={overlayStyle}>
          <Confetti />
          <div
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 18,
              padding: '32px 44px',
              borderRadius: 24,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.06), transparent 25%), linear-gradient(165deg, rgba(58, 46, 30, 0.85), rgba(30, 23, 14, 0.85))',
              border: `3px solid ${getColor(winner.color)}`,
              boxShadow: `0 12px 34px rgba(0,0,0,0.55), 0 0 40px 4px ${getColor(winner.color)}55, inset 0 1px 0 rgba(255,255,255,0.12)`,
            }}
          >
            <div
              style={{
                color: getColor(winner.color),
                fontSize: 'clamp(26px, 7vw, 36px)',
                fontWeight: 800,
                textShadow: '0 2px 0 rgba(0,0,0,0.4), 0 0 22px currentColor',
                textAlign: 'center',
              }}
            >
              ¡{winner.color} gana!
            </div>
            <button className="chunky-btn" onClick={onExit} style={rollButtonStyle(true)}>
              Volver al inicio
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// One pill per seated player, in a single row along the table's bottom edge (wraps on narrow
// phones) - matches the reference's row of player badges rather than the earlier per-side
// columns. Pieces-at-home count uses data already on PlayerState (Piece.state === 'Finished'),
// no new game-state tracking needed.
// isLocal (session.turnManager.localPlayerColor - online play's own seat, or the human's chosen
// color in local vs-bots play; null/undefined for classic local pass-and-play, where every color
// is equally "yours") marks which pill is *this player's own* seat, distinct from isCurrentTurn
// (whose turn it is right now) - reported directly for online play: once a game actually starts,
// nothing on screen said which color a given online player even was anymore (the lobby's own
// "Usted" tag only exists before that point) - important with more than 2 real people in a room,
// where "wait for your own name to light up" isn't enough to know which color that even is in the
// first place. The same tag is just as useful once local play also has non-human seats (bots) to
// tell apart from the human's own.
function PlayerPill({ player, isCurrentTurn, isLocal }: { player: PlayerState; isCurrentTurn: boolean; isLocal: boolean }) {
  const home = player.pieces.filter((p) => p.state === 'Finished').length
  const color = getColor(player.color)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'clamp(5px, 1.5vw, 8px)',
        padding: 'clamp(6px, 1.8vw, 9px) clamp(10px, 2.6vw, 14px)',
        borderRadius: 999,
        background: isCurrentTurn
          ? `linear-gradient(180deg, rgba(255,255,255,0.12), transparent 30%), linear-gradient(165deg, ${color}55, rgba(24,14,9,0.92))`
          : 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent 30%), linear-gradient(165deg, rgba(48,30,20,0.9), rgba(20,12,8,0.92))',
        border: `2px solid ${isLocal ? '#f2d98c' : isCurrentTurn ? color : 'rgba(201,162,75,0.4)'}`,
        boxShadow: isLocal
          ? `0 0 0 2px #f2d98c99, 0 0 12px 1px ${color}66, 0 4px 10px rgba(0,0,0,0.4)`
          : isCurrentTurn
            ? `0 0 12px 1px ${color}66, 0 4px 10px rgba(0,0,0,0.4)`
            : '0 4px 10px rgba(0,0,0,0.35)',
        fontFamily: 'system-ui, sans-serif',
        color: '#f2ede0',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{ width: 'clamp(9px, 2.2vw, 11px)', height: 'clamp(9px, 2.2vw, 11px)', borderRadius: '50%', background: color, boxShadow: '0 0 5px rgba(0,0,0,0.5)', flexShrink: 0 }}
      />
      <span style={{ fontWeight: 800, fontSize: 'clamp(10px, 2.4vw, 12px)', letterSpacing: 0.3 }}>{player.color.toUpperCase()}</span>
      <span style={{ fontSize: 'clamp(10px, 2.4vw, 12px)', color: '#d8d2c2' }}>
        ♟ {home}/{player.pieces.length}
      </span>
      {isLocal && <span style={{ fontWeight: 800, fontSize: 'clamp(9px, 2.2vw, 11px)', color: '#f2d98c' }}>(usted)</span>}
    </div>
  )
}

// Reported directly, calling the procedural 3D wood table "한심하다" (pathetic): the game's own
// ground plane (scene/TableSurface.tsx) is gone entirely now - BoardScene's Canvas is transparent
// and this real photo (moon.jpg, supplied directly) is the page's own CSS background behind it
// instead, same approach as StartScreen's own background photo. `cover` so it always fills the
// screen (see StartScreen's own comment history on cover vs. contain trade-offs - same
// reasoning applies here).
//
// Re-encoded from a 2.4MB PNG to a 192KB JPEG (mozjpeg, quality 84) - same reasoning as
// firstbag.jpg's own comment (src/index.css): a lossless format on a full photograph was pure
// waste, and large enough to still be mid-download when this screen first paints on a slow
// connection, which reads as the background "unfolding" into view instead of just appearing.
const screenWrapperStyle: React.CSSProperties = {
  height: '100%',
  position: 'relative',
  backgroundColor: '#05070c',
  backgroundImage: 'url(/backgrounds/moon.jpg)',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
}

// A thin gold inset line plus a soft dark vignette at the very edges - stands in for the
// reference's ornate gold arch frame without needing bespoke corner art. Pointer-events none so
// it never intercepts clicks meant for the HUD or the 3D scene beneath it.
const frameOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  boxShadow: `inset 0 0 0 3px ${BRAND_GOLD}55, inset 0 0 90px 30px rgba(0,0,0,0.55)`,
}

// Reported directly, with a photoreal reference: turn info lives in one card top-left (avatar +
// title + status + the roll action all together), not spread across a separate banner and a
// floating button - echoes the reference's single "RED'S TURN / Roll the dice" card exactly.
const turnCardStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'max(16px, env(safe-area-inset-top))',
  left: 'max(16px, env(safe-area-inset-left))',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 'clamp(12px, 3vw, 18px)',
  borderRadius: 18,
  background:
    'linear-gradient(180deg, rgba(255,255,255,0.07), transparent 30%), linear-gradient(165deg, rgba(48, 30, 20, 0.94), rgba(22, 13, 9, 0.96))',
  border: `2px solid ${BRAND_GOLD}`,
  boxShadow: `0 8px 22px rgba(0,0,0,0.5), inset 0 0 0 3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)`,
  width: 'clamp(200px, 62vw, 300px)',
  boxSizing: 'border-box',
  fontFamily: 'system-ui, sans-serif',
  color: '#f2ede0',
}

const turnCardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
}

const avatarStyle: React.CSSProperties = {
  width: 'clamp(38px, 9vw, 48px)',
  height: 'clamp(38px, 9vw, 48px)',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 'clamp(18px, 4vw, 22px)',
  color: '#fff',
  border: '2px solid rgba(255,255,255,0.4)',
  boxShadow: '0 3px 8px rgba(0,0,0,0.4), inset 0 2px 3px rgba(255,255,255,0.3)',
  flexShrink: 0,
}

const turnTitleStyle: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 'clamp(14px, 3.6vw, 18px)',
  letterSpacing: 0.4,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const turnSubtitleStyle: React.CSSProperties = {
  fontSize: 'clamp(11px, 2.6vw, 13px)',
  color: '#d8d2c2',
  marginTop: 2,
}

// One row of player pills along the table's bottom edge (see PlayerPill below), matching the
// reference's row of player badges - wraps on narrow phones instead of overflowing.
const playerRowStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 'max(16px, env(safe-area-inset-bottom))',
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: 'clamp(6px, 1.8vw, 10px)',
  maxWidth: 'calc(100vw - 24px)',
  padding: '0 8px',
}

const hintTextStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#d8d2c2',
}

// Full pill shape (borderRadius 999), but now with the same solid (non-blurred) offset bottom
// edge as StartScreen/PlayerCountSelector's own chunky buttons - that crisp edge, not a bigger
// blurred shadow, is what actually reads as physical carved-wood depth. The two screens were
// restyled first and this one still used the earlier blurred-shadow pass, which read as a
// different, plainer button style right where the game's most-pressed button lives - reported
// directly as wanting one consistent button language across every screen, not per-screen styles.
// Reported directly (Carlos's own "life journey" philosophy - camaraderie over competition): this
// was a cold corporate blue, unrelated to anything else this button could mean (it's a generic
// confirm - "Sí, salir", "Volver al inicio" - not tied to "online" the way StartScreen's own blue
// used to be). Warm burgundy instead (matches StartScreen's own TINTS.burgundy exactly), so a
// confirm action reads as warm and deliberate rather than a leftover cool accent.
function rollButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    padding: '12px 24px',
    fontSize: 16,
    fontWeight: 800,
    letterSpacing: 0.3,
    color: enabled ? '#fbeef0' : '#9a9a90',
    background: enabled
      ? 'linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0) 40%), linear-gradient(180deg, #c98a94 0%, #6e2430 55%, #2e0e12 100%)'
      : 'linear-gradient(165deg, #6b6b62, #4a4a44)',
    border: `3px solid ${enabled ? '#3a1219' : '#3a3a34'}`,
    borderRadius: 999,
    boxShadow: enabled
      ? '0 5px 0 #3a1219, 0 9px 14px rgba(0,0,0,0.4), inset 0 2px 1px rgba(255,255,255,0.55)'
      : '0 5px 0 #3a3a34, inset 0 1px 2px rgba(0,0,0,0.3)',
    textShadow: enabled ? '0 1px 2px rgba(40,10,14,0.5)' : 'none',
    cursor: enabled ? 'pointer' : 'default',
  }
}

// Lives inside turnCardStyle - colored to the current player's own swatch (via shade()) rather
// than a fixed brand color, echoing the reference's red-themed button on red's turn.
function cardRollButtonStyle(enabled: boolean, colorHex: string): React.CSSProperties {
  const dark = shade(colorHex, -0.5)
  const light = shade(colorHex, 0.35)
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '12px 20px',
    fontSize: 'clamp(14px, 3.6vw, 17px)',
    fontWeight: 800,
    letterSpacing: 0.5,
    color: enabled ? '#fff6e8' : '#9a9a90',
    background: enabled
      ? `linear-gradient(180deg, rgba(255,255,255,0.45), rgba(255,255,255,0) 40%), linear-gradient(180deg, ${light} 0%, ${colorHex} 55%, ${dark} 100%)`
      : 'linear-gradient(165deg, #6b6b62, #4a4a44)',
    border: `3px solid ${enabled ? dark : '#3a3a34'}`,
    borderRadius: 12,
    boxShadow: enabled
      ? `0 5px 0 ${dark}, 0 9px 14px rgba(0,0,0,0.4), inset 0 2px 1px rgba(255,255,255,0.4)`
      : '0 5px 0 #3a3a34, inset 0 1px 2px rgba(0,0,0,0.3)',
    textShadow: enabled ? '0 1px 2px rgba(0,0,0,0.5)' : 'none',
    cursor: enabled ? 'pointer' : 'default',
  }
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '11px 22px',
  fontSize: 15,
  fontWeight: 700,
  color: '#f2ede0',
  background: 'linear-gradient(165deg, rgba(255,255,255,0.1), rgba(255,255,255,0) 60%), rgba(58, 46, 30, 0.6)',
  border: `3px solid ${BRAND_GOLD}`,
  borderRadius: 999,
  boxShadow: '0 5px 0 #7a5f26, 0 8px 12px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.2)',
  cursor: 'pointer',
}

// The three corner medallions (sound/help/exit) used to each carry their own absolute top/right,
// hand-added up from a fixed 46px + 10px gap - correct on the wide phones it was built against,
// but on an iPhone-width screen (390px, and narrower still on an SE) that fixed math reads as
// cramped: the badges keep their desktop-sized 46px footprint right up against a real notch/
// Dynamic Island with no give at all. One flex row now owns the position (with a safe-area-aware
// inset so a notch/rounded corner never eats into a tap target), and each medallion sizes itself
// off the same vw-based clamp() the turn card's own avatar already uses - shrinks together on a
// narrow phone instead of one fixed pixel size fighting the viewport.
const topRightButtonRowStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'max(16px, env(safe-area-inset-top))',
  right: 'max(16px, env(safe-area-inset-right))',
  display: 'flex',
  gap: 'clamp(6px, 2vw, 10px)',
}

// Round medallion badge instead of a rectangular "Salir" pill - matches the fleur-de-lis/star
// corner ornaments already painted into the board art, and clears the boxy dead space a text
// button left in the corner (reported directly, alongside the panel/roll-button shapes). Same
// solid offset-edge depth as the pill buttons, just circular. Shared by all three top-right
// buttons (sound/help/exit) - positioning now lives on topRightButtonRowStyle instead.
const medallionButtonStyle: React.CSSProperties = {
  width: 'clamp(38px, 10vw, 46px)',
  height: 'clamp(38px, 10vw, 46px)',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 'clamp(14px, 3.6vw, 17px)',
  fontWeight: 700,
  background:
    'linear-gradient(180deg, rgba(255,255,255,0.22), transparent 45%), linear-gradient(165deg, rgba(64, 50, 32, 0.95), rgba(36, 28, 18, 0.95))',
  border: `3px solid ${BRAND_GOLD}`,
  borderRadius: '50%',
  boxShadow: '0 5px 0 #7a5f26, 0 9px 14px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)',
  color: '#f2ede0',
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
  lineHeight: 1,
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  background: 'rgba(0,0,0,0.55)',
}

// Same full-screen click target as overlayStyle above, but rendered above BoardScene rather than
// as a modal choice - covers the whole play area so a click ANYWHERE dismisses it (reported
// directly: "화면의 아무런 자리에 클릭하면 다시 할수있게 해달라"), not just a single button.
const idleWarningOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 40,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  background: 'rgba(10, 6, 2, 0.72)',
  cursor: 'pointer',
}

const idleWarningCountdownStyle: React.CSSProperties = {
  fontSize: 56,
  fontWeight: 800,
  color: BRAND_GOLD,
  fontFamily: 'system-ui, sans-serif',
  lineHeight: 1,
}

const idleWarningTitleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: '#f2ede0',
  fontFamily: 'system-ui, sans-serif',
}
