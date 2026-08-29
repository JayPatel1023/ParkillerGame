import { useEffect, useRef, useState } from 'react'
import type { PlayerState } from '../core/gameFlow/playerState'
import type { DiceRoll, MoveAnimationInfo, MoveNotPossibleReason, ParkillerMoveResult, RewardGrant } from '../core/gameFlow/turnManager'
import type { TurnManagerLike } from '../core/gameFlow/turnManagerLike'
import type { PieceColor } from '../core/pieceColor'
import type { Piece } from '../core/pieces/piece'
import type { MoveOption, MoveResult } from '../core/rules/moveOption'

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
export type MoveAnimationRequest = MoveAnimationInfo

// Reported directly: pieces sometimes hopped at a normal, readable pace and sometimes moved "at
// light speed" - worst with an online bot, but really any roll this client didn't itself trigger
// (a bot's own roll, or a remote opponent's roll replayed from a broadcast). Root cause: the
// dice-spin animation only ever played for a roll that went through this hook's own rollDice()
// below (setRolling(true) then a delayed requestRoll() call) - a bot's rollForBot() and a remote
// client's replayed requestRoll() both call straight into TurnManager, skipping rollDice()
// entirely, so `rolling` never turned true and the dice values just snapped in with no spin at
// all. Moved the spin here instead, into the *event* every roll fires regardless of who
// triggered it, so it's no longer tied to which code path made the call.
const DICE_SPIN_MS = 450

// Reported directly (Carlos: "Cuando hay una barrera no se quieren mover ninguno de los dos
// peones... no ha manera" - when there's a barrier neither pawn wants to move, no way out): a
// barrier-forfeited roll used to look identical to a silent freeze, because moveNotPossible and
// the turnStarted that immediately follows it (see finishDiceUsage/endTurn in turnManager.ts) both
// fire synchronously within the same call to requestRoll() - React 18 batches every state update
// from that whole synchronous chain into one commit, so a message set by moveNotPossible's own
// handler was overwritten by turnStarted's handler before a single frame ever rendered it. Rather
// than changing turnStarted's own timing everywhere (every other turn-ending path - a normal move,
// doubles' extra turn, third-double-forfeit - already reads fine with no delay at all), only the
// specific turnStarted that immediately follows a same-tick moveNotPossible gets held back, for
// long enough to actually read the explanation, via sawNoMoveRef below.
const NO_MOVE_HOLD_MS = 2000

export interface MoveLogEntry {
  id: number
  color: PieceColor
  text: string
}

const MOVE_LOG_LIMIT = 50

// Every branch here reads a real, distinguishing field already on MoveResult - no separate
// "what kind of move was this" flag needed. Order matters: a landing square that both captures
// and (implausibly) finishes a piece describes the rarer/more specific outcome first.
function describeMove(result: MoveResult): string {
  const color = result.movedPiece.color
  if (result.eliminatedByParkiller && result.eliminatedByParkillerColor) {
    return `${color}'s pawn was sent home by ${result.eliminatedByParkillerColor}'s Parki`
  }
  if (result.capturedParkillerColor) {
    return `${color} eliminated ${result.capturedParkillerColor}'s Parki`
  }
  if (result.capturedPiece) {
    return `${color} captured ${result.capturedPiece.color}'s pawn`
  }
  if (result.pieceFinished) {
    return `${color}'s pawn reached home`
  }
  return `${color} moved a pawn`
}

// The Parkiller moves automatically every single roll (PK1-8 - never a player choice), so logging
// every plain move would flood the log with one near-identical, uninformative entry per turn,
// pushing rarer entries (captures) straight out of MoveLog's own short visible window. Only the
// two outcomes that are actually news - a Parki eliminating another Parki, or sending a pawn home -
// produce an entry; a plain hop returns null and is skipped entirely.
function describeParkillerMove(result: ParkillerMoveResult): string | null {
  if (result.capturedParkillerColor && result.secondCapturedParkillerColor) {
    return `${result.color}'s Parki eliminated ${result.capturedParkillerColor}'s and ${result.secondCapturedParkillerColor}'s Parkis`
  }
  if (result.capturedParkillerColor) {
    return `${result.color}'s Parki eliminated ${result.capturedParkillerColor}'s Parki`
  }
  if (result.capturedPawn) {
    return `${result.color}'s Parki sent ${result.capturedPawn.color}'s pawn home`
  }
  return null
}

export function useTurnManager(turnManager: TurnManagerLike) {
  const [currentPlayer, setCurrentPlayer] = useState<PlayerState>(turnManager.currentPlayer)
  const [lastRoll, setLastRoll] = useState<DiceRoll | null>(null)
  const [rolling, setRolling] = useState(false)
  const [pendingMoves, setPendingMoves] = useState<MoveOption[]>([])
  const [winner, setWinner] = useState<PlayerState | null>(null)
  const [moveAnimation, setMoveAnimation] = useState<MoveAnimationRequest | null>(null)
  const [parkillerAnimation, setParkillerAnimation] = useState<ParkillerMoveResult | null>(null)
  const [eliminatedByDoubles, setEliminatedByDoubles] = useState<Piece | null>(null)
  const [pendingReward, setPendingReward] = useState<RewardGrant | null>(null)
  const [forfeitedReward, setForfeitedReward] = useState<RewardGrant | null>(null)
  // See NO_MOVE_HOLD_MS's own comment - noMoveReason/turnEndingSoon are what the "barrier locked"
  // message and the disabled-until-it-clears roll button are driven from; sawNoMoveRef/
  // deferredTurnTimeoutRef are the plumbing that holds turnStarted back only when it immediately
  // follows a same-tick moveNotPossible.
  const [noMoveReason, setNoMoveReason] = useState<MoveNotPossibleReason | null>(null)
  const [turnEndingSoon, setTurnEndingSoon] = useState(false)
  const sawNoMoveRef = useRef(false)
  const deferredTurnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Stale-closure workaround for the turnStarted handler below (this effect only ever runs once
  // per turnManager instance, so reading the `currentPlayer` state variable directly inside it
  // would always see its very first value, never an updated one) - see that handler's own comment
  // on why it needs to know the *previous* current player, not just the incoming one.
  const currentPlayerColorRef = useRef(turnManager.currentPlayer.color)
  const [moveLog, setMoveLog] = useState<MoveLogEntry[]>([])
  const moveLogIdRef = useRef(0)
  useEffect(() => {
    const pushLogEntry = (color: PieceColor, text: string) => {
      moveLogIdRef.current += 1
      setMoveLog((prev) => [{ id: moveLogIdRef.current, color, text }, ...prev].slice(0, MOVE_LOG_LIMIT))
    }

    const unsubscribers = [
      turnManager.turnStarted.on((player) => {
        // Reported directly ("Salió doble 1 y no dejó repetir el lanzamiento de los dados" - a
        // double came up and it wouldn't let the roll happen again): a double that grants a bonus
        // turn fires this exact same same-tick moveNotPossible -> turnStarted sequence whenever
        // that roll's own dice have nothing to move (see finishDiceUsage/endTurn in
        // turnManager.ts) - but `player` here is the SAME player continuing, not a different one to
        // hold this reveal for. NO_MOVE_HOLD_MS's own delay only ever made sense for an actual turn
        // handoff (see its own comment) - applying it here too disabled the roll button for
        // NO_MOVE_HOLD_MS on a roll the player had already earned back, reading as "the game just
        // won't let me roll again."
        if (sawNoMoveRef.current && player.color !== currentPlayerColorRef.current) {
          sawNoMoveRef.current = false
          setTurnEndingSoon(true)
          if (deferredTurnTimeoutRef.current) clearTimeout(deferredTurnTimeoutRef.current)
          deferredTurnTimeoutRef.current = setTimeout(() => {
            deferredTurnTimeoutRef.current = null
            currentPlayerColorRef.current = player.color
            setCurrentPlayer(player)
            setPendingMoves([])
            setLastRoll(null)
            setNoMoveReason(null)
            setTurnEndingSoon(false)
          }, NO_MOVE_HOLD_MS)
          return
        }
        sawNoMoveRef.current = false
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
      }),
      turnManager.diceRolled.on((roll) => {
        // The roll itself (and every consequence of it - Parkiller move, capture, etc.) has
        // already happened synchronously by the time this event fires, same as every other event
        // here - only the reveal is delayed, spinning first so the values don't just snap in.
        setRolling(true)
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
        const text = describeParkillerMove(result)
        if (text) pushLogEntry(result.color, text)
      }),
      turnManager.moveChoicesReady.on((moves) => {
        setPendingMoves(moves)
        setNoMoveReason(null)
      }),
      turnManager.moveNotPossible.on((reason) => {
        setPendingMoves([])
        setNoMoveReason(reason)
        sawNoMoveRef.current = true
      }),
      turnManager.moveApplied.on((result) => {
        setPendingMoves([])
        // Cleared here and re-set by rewardOffered/rewardForfeited if this move earned another one -
        // both happen synchronously within the same submitMove call, so React batches them together.
        setPendingReward(null)
        pushLogEntry(result.movedPiece.color, describeMove(result))
      }),
      // Fires from inside TurnManager.submitMove() itself, not built here around a UI-triggered
      // call to it (as this used to be) - see MoveAnimationInfo's own comment for why that missed
      // bot moves and remote clients' own moves entirely.
      turnManager.moveAnimationReady.on((info) => setMoveAnimation(info)),
      turnManager.pieceEliminatedByDoubles.on((piece) => {
        setEliminatedByDoubles(piece)
        pushLogEntry(piece.color, `${piece.color}'s pawn was sent home (third double)`)
      }),
      turnManager.rewardOffered.on((grant) => {
        setPendingReward(grant)
        setForfeitedReward(null)
      }),
      // No matching moveApplied ever follows a forfeit (nothing moved - the reward was simply
      // lost), unlike a *taken* reward, which already gets its own entry via moveApplied/
      // describeMove above - this is the one reward outcome that would otherwise be invisible to
      // the log entirely. RewardGrant itself carries no color (see its own doc comment - it's
      // always implicitly the roller's), so this reads it straight off TurnManager's own live
      // currentPlayer, correct here since a forfeit is resolved mid-turn, well before any turn
      // transition could move it on to someone else.
      turnManager.rewardForfeited.on((grant) => {
        setPendingReward(null)
        setForfeitedReward(grant)
        pushLogEntry(turnManager.currentPlayer.color, `${turnManager.currentPlayer.color}'s bonus reward went unused`)
      }),
      turnManager.gameWon.on((player) => {
        setWinner(player)
        pushLogEntry(player.color, `${player.color} wins!`)
      }),
    ]
    return () => {
      unsubscribers.forEach((off) => off())
      if (deferredTurnTimeoutRef.current) clearTimeout(deferredTurnTimeoutRef.current)
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
    eliminatedByDoubles,
    pendingReward,
    forfeitedReward,
    noMoveReason,
    turnEndingSoon,
    moveLog,
    rollDice,
    chooseMove,
    clearMoveAnimation,
    clearParkillerAnimation,
  }
}
