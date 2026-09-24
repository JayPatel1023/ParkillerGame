import { useEffect, useRef, useState } from 'react'
import type { PlayerState } from '../core/gameFlow/playerState'
import type { DiceRoll, MoveAnimationInfo, MoveNotPossibleReason, ParkillerMoveResult, RewardGrant } from '../core/gameFlow/turnManager'
import type { TurnManagerLike } from '../core/gameFlow/turnManagerLike'
import type { Piece } from '../core/pieces/piece'
import type { MoveOption } from '../core/rules/moveOption'
import { playDiceRollSound } from '../ui/diceSound'
import { CaptureFlightHoldTracker } from './captureFlightHold'
import { DeferredTurnSwitchTracker } from './deferredTurnSwitch'
import { turnHandoffDelayMs } from './turnHandoffDelay'

/**
 * The opponent piece a move captured, if any. Rules apply a capture the instant the move is
 * submitted (the captured piece's own state flips to InYard right away, same as everything else),
 * but visually it should stay put until the capturing piece's hop animation actually arrives - see
 * BoardScene, which keeps rendering this piece at the capture square for as long as `moveAnimation`
 * names it here, only letting it snap home once the animation completes. Same idea for
 * capturedParkillerColor, but for an opposing Parkiller (PK6) the move eliminated.
 *
 * Shape comes straight from TurnManager's own moveAnimationReady event (see MoveAnimationInfo) -
 * re-exported under this name since BoardScene/GameBoardScreen already import it from here.
 */
export type MoveAnimationRequest = MoveAnimationInfo & {
  /** A second piece hopping at the same time as `piece` - the other exit of a double 5 (see
   * TurnManager's own doubleExitPairable). The engine emits it as its own moveAnimationReady event
   * right after the first, flagged simultaneousWithPrevious; it's folded in here because the scene
   * animates a single slot. */
  simultaneousWith?: MoveAnimationInfo
}

// Reported directly: pieces sometimes hopped at a normal, readable pace and sometimes moved "at
// light speed" - worst with an online bot, but really any roll this client didn't itself trigger
// (a bot's own roll, or a remote opponent's roll replayed from a broadcast). Root cause: the
// dice-spin animation only ever played for a roll that went through this hook's own rollDice()
// below (setRolling(true) then a delayed requestRoll() call) - a bot's rollForBot() and a remote
// client's replayed requestRoll() both call straight into TurnManager, skipping rollDice()
// entirely, so `rolling` never turned true and the dice values just snapped in with no spin at
// all. Moved the spin here instead, into the *event* every roll fires regardless of who
// triggered it, so it's no longer tied to which code path made the call.
// Reported directly ("Va demasiado rápido. No se ha puesto la pantalla y ya están saltando los
// peones" - it goes too fast, the screen hasn't even settled and the pawns are already jumping;
// "una latencia de 2-3 segundos bastaría... para ver y poder pensar" - a 2-3 second latency would
// be enough to see and think): 450ms was only ever tuned as a dice-spin *reveal* duration, not as
// real viewing time - and it's the one gate every hop everywhere waits on (see diceSettledAt's own
// doc comment below), including the Parkiller's fully automatic move, which needs no player click
// at all and so had nothing else slowing it down. Bumped to the client's own stated minimum.
//
// Deliberately NOT the same knob as the gap between two different players' own turns - corrected
// directly after a first attempt conflated the two ("이영상에서와같이... 주사위가 돌아가는시간을
// 길게 해달라는의미는전혀없다... 빨간팀이 움직인다음 파란팀이되였다고하자 이때 간격차이, 이간격차를
// 10초로 달라는것이다" - I never meant to make the dice-spin time itself longer, it should spin a
// normal length; what I meant is the gap specifically when it hands off from one team to a
// different one). See TURN_CHANGE_HOLD_MS below for that separate knob - kept in sync with
// botController.ts's own DICE_SPIN_MS, which must change together with this one (see its own
// matching comment).
const DICE_SPIN_MS = 2000

// See DICE_SPIN_MS's own doc comment for the direct correction this came from - specifically the
// pause between one player's turn ending and a *different* player's turn becoming visible/rollable
// (never applied when a double just grants the same player another roll - see the handler below).
// Also now covers what NO_MOVE_HOLD_MS used to handle on its own (a barrier-forfeited roll that
// used to look identical to a silent freeze, because moveNotPossible and the turnStarted that
// immediately follows it - see finishDiceUsage/endTurn in turnManager.ts - both fire synchronously
// within the same call to requestRoll(), batched into one React commit) - that was always a
// *subset* of "handing off to a different player," just with a shorter, separately-tuned hold;
// unified under this one constant since every genuine handoff now gets held the same way
// regardless of whether a no-move message needs to stay readable through it too.
//
// Set to 3000, not the 10000 first tried here - correcting again, directly ("이것이 너무길다
// 클라이언트가 말한대로 해야한다" - this is too long, it has to match what the client actually
// said): 10 seconds was this session's own guess, never something Carlos asked for. His own
// consistently repeated number, across three separate reports, is 2-3 seconds ("Tienes que dejar
// una latencia de dos segundos entre movimientos", "una latencia de 2-3 segundos bastaría", "al bot
// dejale 2 o 3 segundos nada mas") - matching the upper end of that same range. Kept in sync with
// botController.ts's own TURN_CHANGE_HOLD_MS, which must change together with this one (see its
// own matching comment) - otherwise a bot could roll for its own turn before this hook's own hold
// here finishes revealing it, desyncing the dice/board from what the screen still shows.
const TURN_CHANGE_HOLD_MS = 3000

// Kept in sync with piecePosition.ts's own CAPTURE_RETURN_HOPS (3) and PieceMesh.tsx's own
// HOP_DURATION (0.48s, *1000 here) - same "duplicated across layers" reasoning as
// botController.ts's/RemoteTurnManager.ts's own matching constants (this hook can't import the
// scene layer either). Drives captureFlightPending below - see its own doc comment for the bug
// this covers, found (and fixed) after both of those files' own busy/pacing fixes had already
// shipped and the exact same reported symptom kept recurring anyway.
const HOP_DURATION_MS = 480
const CAPTURE_RETURN_HOPS = 3

export function useTurnManager(turnManager: TurnManagerLike) {
  const [currentPlayer, setCurrentPlayer] = useState<PlayerState>(turnManager.currentPlayer)
  const [lastRoll, setLastRoll] = useState<DiceRoll | null>(null)
  const [rolling, setRolling] = useState(false)
  const [pendingMoves, setPendingMoves] = useState<MoveOption[]>([])
  const [winner, setWinner] = useState<PlayerState | null>(null)
  const [moveAnimation, setMoveAnimation] = useState<MoveAnimationRequest | null>(null)
  const [parkillerAnimation, setParkillerAnimation] = useState<ParkillerMoveResult | null>(null)
  // Requested directly ("주사위가 돌아가는시간과... 말들이 움직이는시간이 일치하지않을때있다" - the
  // dice-spin timing and the piece-movement timing don't match sometimes): moveAnimation/
  // parkillerAnimation are set the instant their own events fire (moveAnimationReady/parkillerMoved,
  // both synchronous - TurnManager itself never waits on animation), which is well before this
  // hook's own DICE_SPIN_MS reveal delay below has necessarily finished. A human's own click is
  // naturally safe (it can only happen once the player has already seen the dice, well after the
  // spin), but an automatic move - a bot's, or a remote client replaying someone else's broadcast
  // turn - has no such guarantee, and the diceRolled/moveAnimationReady broadcasts can arrive back
  // to back over any real network latency. The scene layer can't just add a blind fixed wait before
  // starting a hop (PieceMesh/ParkillerMesh have no way to tell "the dice already settled a while
  // ago" from "the dice just barely started spinning" without this) and it can't be fixed by
  // delaying moveAnimation/parkillerAnimation being *set* either - see parkillerMoved's own comment
  // below for the "flashes to the final position, then snaps back" bug that caused directly. This
  // exposes the actual deadline instead: the scene layer only ever needs to hold at its own
  // hopFrom until Date.now() reaches this, and can start immediately whenever that's already true.
  const [diceSettledAt, setDiceSettledAt] = useState(0)
  const [eliminatedByDoubles, setEliminatedByDoubles] = useState<Piece | null>(null)
  const [pendingReward, setPendingReward] = useState<RewardGrant | null>(null)
  const [forfeitedReward, setForfeitedReward] = useState<RewardGrant | null>(null)
  // See TURN_CHANGE_HOLD_MS's own comment - noMoveReason/turnEndingSoon are what the "no move
  // possible" message and the disabled-until-it-clears roll button are driven from;
  // deferredTurnSwitchRef (lazy-initialized further below) is the plumbing that holds a genuine
  // turn handoff back for the reveal.
  const [noMoveReason, setNoMoveReason] = useState<MoveNotPossibleReason | null>(null)
  const [turnEndingSoon, setTurnEndingSoon] = useState(false)
  // Stale-closure workaround for the turnStarted handler below (this effect only ever runs once
  // per turnManager instance, so reading the `currentPlayer` state variable directly inside it
  // would always see its very first value, never an updated one) - see that handler's own comment
  // on why it needs to know the *previous* current player, not just the incoming one.
  const currentPlayerColorRef = useRef(turnManager.currentPlayer.color)
  // See turnHandoffDelayMs's own doc comment for the bug this fixes: the different-player branch
  // of turnStarted below used to hold its handoff back by a single flat TURN_CHANGE_HOLD_MS,
  // regardless of how long the move that triggered it will actually take to animate on screen.
  // Set on every moveApplied (the move that's about to - possibly - trigger a handoff), read back
  // by that same turnStarted handler, which fires synchronously within the same call stack as the
  // moveApplied that preceded it (submitMove -> ... -> endTurn -> turnStarted.emit, all
  // synchronous - see turnManager.ts's own submitMove) - so this is always this handoff's own
  // move, never a stale one left over from earlier.
  const lastMoveForHandoffRef = useRef<{ amount: number; captured: boolean }>({ amount: 0, captured: false })
  // Captured pawn (PC3/PC4) or Parki-eliminated pawn (PK5, via moveAnimation.capturedPiece) and a
  // pawn a Parkiller itself sends home (parkillerAnimation.capturedPawn) both spawn their own
  // separate "flung home" bounce-home animation once the CAPTURING piece's own hop finishes
  // (BoardScene.tsx's own captureFlights/spawnCaptureEffects - see that file's own doc comment:
  // "it doesn't gate or delay anything else about turn flow" on its own). Reported directly, again,
  // after both botController.ts's own busy-time fix (bot pacing) and RemoteTurnManager.ts's own
  // pacing fix (online replay) had already shipped for this exact symptom ("Sigue volviendo atrás
  // antes de que lance el jugador siguiente" - it keeps going back before the next player rolls):
  // neither of those touches this - canRoll (GameBoardScreen.tsx) only ever waited on
  // moveAnimation/parkillerAnimation themselves, which already clear the instant the CAPTURING
  // piece's own hop finishes, well before the CAPTURED piece's own bounce-home has even started.
  // A same-player bonus roll (a double) has NO turn-handoff hold at all (see TURN_CHANGE_HOLD_MS's
  // own comment - never applied for the same player continuing), so a human could click "roll"
  // again immediately, re-arming the shared diceSettledAt gate (see its own doc comment above)
  // while the just-captured pawn's own flight was still genuinely playing - entirely local,
  // no bot, no network, reproducing the identical "reverts, then catches up" symptom. This state
  // - and captureFlightHoldRef below, which drives it - fixes that: true for exactly
  // CAPTURE_RETURN_HOPS*HOP_DURATION_MS after either animation's own trailing edge (see the two
  // effects below), consumed by GameBoardScreen's own animationsSettled alongside
  // moveAnimation/parkillerAnimation.
  const [captureFlightPending, setCaptureFlightPending] = useState(false)
  // Lazy-initialized once per hook instance (not per render) - see CaptureFlightHoldTracker's own
  // doc comment for why this plain timer class lives outside React state/effects entirely.
  const captureFlightHoldRef = useRef<CaptureFlightHoldTracker | null>(null)
  if (!captureFlightHoldRef.current) {
    captureFlightHoldRef.current = new CaptureFlightHoldTracker(setCaptureFlightPending, CAPTURE_RETURN_HOPS * HOP_DURATION_MS)
  }
  // Lazy-initialized once per hook instance, same pattern as captureFlightHoldRef just above -
  // see DeferredTurnSwitchTracker's own doc comment (deferredTurnSwitch.ts) for the bug this
  // fixes: the turn-card header/avatar (GameBoardScreen.tsx) read `currentPlayer` directly, with
  // no animationsSettled gate of their own, so a turnHandoffDelayMs-estimated hold that still
  // undershot the real hop animation (a longer-than-estimated reward chain, ordinary timer
  // jitter) let the header flip to the incoming player while the outgoing player's own move was
  // still visibly animating. The onSwitch callback below is exactly the different-player branch's
  // old setTimeout body, unchanged - only *when* it fires has moved into the tracker.
  const deferredTurnSwitchRef = useRef<DeferredTurnSwitchTracker<PlayerState> | null>(null)
  if (!deferredTurnSwitchRef.current) {
    deferredTurnSwitchRef.current = new DeferredTurnSwitchTracker<PlayerState>((player) => {
      currentPlayerColorRef.current = player.color
      setCurrentPlayer(player)
      setPendingMoves([])
      setLastRoll(null)
      setNoMoveReason(null)
      setTurnEndingSoon(false)
    })
  }
  // Keeps the tracker's own notion of animationsSettled current - see its own
  // setAnimationsSettled doc comment for why this needs to be pushed on every change rather than
  // read back lazily (the tracker has no React state of its own to re-render off of).
  useEffect(() => {
    deferredTurnSwitchRef.current?.setAnimationsSettled(!moveAnimation && !parkillerAnimation && !captureFlightPending)
  }, [moveAnimation, parkillerAnimation, captureFlightPending])
  useEffect(() => () => deferredTurnSwitchRef.current?.dispose(), [])
  // Trailing-edge detection, same pattern as BoardScene.tsx's own captureFlights-spawning effects
  // (moveAnimation/parkillerAnimation going from "had a capture" to null, in that exact tick) - see
  // captureFlightPending's own doc comment just above for why this needs its own tracking here too,
  // not just in the scene layer.
  const prevMoveAnimationForCaptureRef = useRef<MoveAnimationRequest | null>(null)
  useEffect(() => {
    const prevMove = prevMoveAnimationForCaptureRef.current
    if (!moveAnimation && (prevMove?.capturedPiece || prevMove?.simultaneousWith?.capturedPiece)) captureFlightHoldRef.current?.trigger()
    prevMoveAnimationForCaptureRef.current = moveAnimation
  }, [moveAnimation])
  const prevParkillerAnimationForCaptureRef = useRef<ParkillerMoveResult | null>(null)
  useEffect(() => {
    const prevParkiller = prevParkillerAnimationForCaptureRef.current
    if (!parkillerAnimation && prevParkiller?.capturedPawn) captureFlightHoldRef.current?.trigger()
    prevParkillerAnimationForCaptureRef.current = parkillerAnimation
  }, [parkillerAnimation])
  useEffect(() => () => captureFlightHoldRef.current?.dispose(), [])
  useEffect(() => {
    const unsubscribers = [
      turnManager.turnStarted.on((player) => {
        // Reported directly ("Salió doble 1 y no dejó repetir el lanzamiento de los dados" - a
        // double came up and it wouldn't let the roll happen again): a double that grants a bonus
        // turn fires this exact same same-tick moveNotPossible -> turnStarted sequence whenever
        // that roll's own dice have nothing to move (see finishDiceUsage/endTurn in
        // turnManager.ts) - but `player` here is the SAME player continuing, not a different one to
        // hold this reveal for. TURN_CHANGE_HOLD_MS's own delay only ever makes sense for an actual
        // turn handoff (see its own comment) - applying it here too would disable the roll button
        // on a roll the player had already earned back, reading as "the game just won't let me roll
        // again."
        if (player.color !== currentPlayerColorRef.current) {
          setTurnEndingSoon(true)
          // See deferredTurnSwitchRef's own doc comment above - the hold itself is still
          // turnHandoffDelayMs's per-move estimate (unchanged), but the tracker now also waits for
          // animationsSettled to genuinely be true before it actually calls setCurrentPlayer, so a
          // move whose real hop outlasts that estimate no longer flips the header/avatar early.
          deferredTurnSwitchRef.current?.schedule(
            player,
            turnHandoffDelayMs(TURN_CHANGE_HOLD_MS, lastMoveForHandoffRef.current.amount, HOP_DURATION_MS, lastMoveForHandoffRef.current.captured, CAPTURE_RETURN_HOPS),
          )
          return
        }
        currentPlayerColorRef.current = player.color
        setCurrentPlayer(player)
        setPendingMoves([])
        // Reported directly ("Estoy jugando con las azules... no he podido jugar ni siquiera yo
        // solo"): lastRoll used to survive across the turn boundary untouched - a brand new turn
        // (this player's own bonus turn included) rendered the *previous* roller's dice values
        // under "Dados: X y Y", indistinguishable from this turn's own roll, right up until this
        // player actually rolled again. GameBoardScreen's own statusLine falls straight to that
        // branch whenever pendingMoves is empty (just cleared above) and nothing else is pending,
        // which is exactly the state a fresh turn starts in - reading as "the dice are already
        // rolled" when nothing has happened yet this turn at all.
        setLastRoll(null)
        // Found via close video review (a double with no legal white-dice move: the "Ningún
        // movimiento posible con esta tirada" banner stayed on screen for 9+ seconds while the
        // TIRAR DADOS button had already re-enabled for the bonus roll): this same-player branch
        // used to clear only pendingMoves/lastRoll, never noMoveReason. The different-player
        // branch above already clears it (after its own TURN_CHANGE_HOLD_MS delay) because a turn
        // handoff means the reason no longer describes the player now on turn - but a same-player
        // bonus turn is exactly the same situation: the forfeited roll that produced noMoveReason
        // is over, and canRoll (GameBoardScreen.tsx) never gates on noMoveReason at all, so the
        // button re-enabling here left the stale banner as the only thing still describing the
        // previous, already-resolved roll. Clearing it here means it can't outlive the turn it
        // was about.
        setNoMoveReason(null)
      }),
      turnManager.diceRolled.on((roll) => {
        // The roll itself (and every consequence of it - Parkiller move, capture, etc.) has
        // already happened synchronously by the time this event fires, same as every other event
        // here - only the reveal is delayed, spinning first so the values don't just snap in.
        setRolling(true)
        // Fires here (not tied to who/what triggered the roll) so every roll gets the sound
        // regardless of source - a human's own click, a bot's own roll, or a remote client
        // replaying someone else's broadcast - same reasoning as the dice-spin reveal itself below.
        playDiceRollSound()
        // See diceSettledAt's own doc comment above - computed immediately (not read back inside
        // the setTimeout below) so it's available to the scene layer the instant moveAnimation/
        // parkillerAnimation themselves are set, which can happen before this timeout ever fires.
        setDiceSettledAt(Date.now() + DICE_SPIN_MS)
        setTimeout(() => {
          setLastRoll(roll)
          setRolling(false)
          setEliminatedByDoubles(null)
          setPendingReward(null)
          setForfeitedReward(null)
        }, DICE_SPIN_MS)
      }),
      // Reported directly, twice now, in opposite directions: setting this immediately made the
      // Parkiller visibly start hopping before the dice even finished revealing (parkillerMoved
      // fires synchronously right after diceRolled, well before diceRolled's own reveal delay
      // above) - but delaying *this* set call instead (an earlier attempt) caused a worse bug:
      // player.parkiller is a live, mutable object TurnManager already updated to its POST-move
      // values the instant this event fired, completely independent of when this hook's own state
      // updates - so BoardScene's restPosition (read straight from that live object whenever
      // parkillerAnimation is still null) flashed to the final position immediately, then visibly
      // snapped back to the start once parkillerAnimation/hopFrom finally arrived. Setting this
      // immediately (matching moveAnimationReady's own timing just below) avoids that entirely -
      // ParkillerMesh itself is what holds off actually progressing the hop until the dice reveal,
      // see its own hopStartDelay comment for why that's the layer this belongs in instead.
      turnManager.parkillerMoved.on((result) => {
        setParkillerAnimation(result)
      }),
      turnManager.moveChoicesReady.on((moves) => {
        setPendingMoves(moves)
        setNoMoveReason(null)
      }),
      turnManager.moveNotPossible.on((reason) => {
        setPendingMoves([])
        setNoMoveReason(reason)
      }),
      turnManager.moveApplied.on((result) => {
        // See lastMoveForHandoffRef's own doc comment above - captured the same way
        // botController.ts's/RemoteTurnManager.ts's own matching capture-bounce checks are (never
        // capturedParkillerColor - an eliminated Parkiller has no yard to bounce home to, so it
        // spawns no captureFlights animation to budget for, see this file's own captureFlightPending
        // doc comment).
        lastMoveForHandoffRef.current = { amount: result.amount, captured: Boolean(result.eliminatedByParkiller || result.capturedPiece) }
        setPendingMoves([])
        // Cleared here and re-set by rewardOffered/rewardForfeited if this move earned another one -
        // both happen synchronously within the same submitMove call, so React batches them together.
        setPendingReward(null)
        // Reported directly ("anuncios de recompensas... se quedan bloqueadas... deben borrarse
        // inmediatamente después de usarlas" - reward announcements get stuck on screen, they
        // should clear immediately after being used): forfeitedReward/eliminatedByDoubles used to
        // be cleared *only* inside diceRolled's own delayed setTimeout above - fine for the roll
        // that actually set them, but submitMove() can forfeit a reward (offerReward -> no valid
        // landing -> rewardForfeited.emit) and then immediately offer the same roll's still-unspent
        // die again (continueAfterMove -> offerMoves), all synchronously, with no diceRolled in
        // between. That left a stale forfeitedReward/eliminatedByDoubles sitting there with no
        // timer ever going to clear it - and, worse, GameBoardScreen's own useHeldAlert re-arms its
        // full hold countdown on every null->non-null transition, so animationsSettled cycling
        // false/true across this move's own animation kept re-exposing the same stale value as if
        // it were brand new, on every subsequent move within the same roll. Cleared here too, same
        // as pendingReward just above, so a genuinely new forfeit/elimination on *this* move still
        // wins (rewardForfeited/pieceEliminatedByDoubles fire later in the same synchronous batch
        // and React batches the re-set on top of this clear).
        setForfeitedReward(null)
        setEliminatedByDoubles(null)
      }),
      // Fires from inside TurnManager.submitMove() itself, not built here around a UI-triggered
      // call to it (as this used to be) - see MoveAnimationInfo's own comment for why that missed
      // bot moves and remote clients' own moves entirely.
      turnManager.moveAnimationReady.on((info) =>
        setMoveAnimation((prev) => (info.simultaneousWithPrevious && prev ? { ...prev, simultaneousWith: info } : info)),
      ),
      turnManager.pieceEliminatedByDoubles.on((piece) => {
        setEliminatedByDoubles(piece)
      }),
      turnManager.rewardOffered.on((grant) => {
        setPendingReward(grant)
        setForfeitedReward(null)
      }),
      turnManager.rewardForfeited.on((grant) => {
        setPendingReward(null)
        setForfeitedReward(grant)
      }),
      turnManager.gameWon.on((player) => {
        setWinner(player)
      }),
    ]
    return () => {
      unsubscribers.forEach((off) => off())
      deferredTurnSwitchRef.current?.dispose()
    }
  }, [turnManager])

  function rollDice() {
    // The spin/reveal delay now lives in the diceRolled listener above, which fires for every
    // roll regardless of who triggered it - nothing extra to do here beyond the request itself.
    turnManager.requestRoll()
  }

  function chooseMove(piece: Piece, amount?: number) {
    turnManager.submitMove(piece, amount)
  }

  function clearMoveAnimation() {
    setMoveAnimation(null)
  }

  function clearParkillerAnimation() {
    setParkillerAnimation(null)
  }

  return {
    currentPlayer,
    lastRoll,
    rolling,
    pendingMoves,
    winner,
    moveAnimation,
    parkillerAnimation,
    diceSettledAt,
    captureFlightPending,
    eliminatedByDoubles,
    pendingReward,
    forfeitedReward,
    noMoveReason,
    turnEndingSoon,
    rollDice,
    chooseMove,
    clearMoveAnimation,
    clearParkillerAnimation,
  }
}
