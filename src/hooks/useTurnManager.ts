import { useEffect, useState } from 'react'
import type { PlayerState } from '../core/gameFlow/playerState'
import type { DiceRoll, MoveAnimationInfo, ParkillerMoveResult, RewardGrant } from '../core/gameFlow/turnManager'
import type { TurnManagerLike } from '../core/gameFlow/turnManagerLike'
import type { Piece } from '../core/pieces/piece'
import type { MoveOption } from '../core/rules/moveOption'

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
  useEffect(() => {
    const unsubscribers = [
      turnManager.turnStarted.on((player) => {
        setCurrentPlayer(player)
        setPendingMoves([])
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
      turnManager.parkillerMoved.on((result) => setParkillerAnimation(result)),
      turnManager.moveChoicesReady.on((moves) => setPendingMoves(moves)),
      turnManager.moveNotPossible.on(() => setPendingMoves([])),
      turnManager.moveApplied.on(() => {
        setPendingMoves([])
        // Cleared here and re-set by rewardOffered/rewardForfeited if this move earned another one -
        // both happen synchronously within the same submitMove call, so React batches them together.
        setPendingReward(null)
      }),
      // Fires from inside TurnManager.submitMove() itself, not built here around a UI-triggered
      // call to it (as this used to be) - see MoveAnimationInfo's own comment for why that missed
      // bot moves and remote clients' own moves entirely.
      turnManager.moveAnimationReady.on((info) => setMoveAnimation(info)),
      turnManager.pieceEliminatedByDoubles.on((piece) => setEliminatedByDoubles(piece)),
      turnManager.rewardOffered.on((grant) => {
        setPendingReward(grant)
        setForfeitedReward(null)
      }),
      turnManager.rewardForfeited.on((grant) => {
        setPendingReward(null)
        setForfeitedReward(grant)
      }),
      turnManager.gameWon.on((player) => setWinner(player)),
    ]
    return () => unsubscribers.forEach((off) => off())
  }, [turnManager])

  function rollDice() {
    // The spin/reveal delay now lives in the diceRolled listener above, which fires for every
    // roll regardless of who triggered it - nothing extra to do here beyond the request itself.
    turnManager.requestRoll()
  }

  function chooseMove(piece: Piece) {
    turnManager.submitMove(piece)
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
    rollDice,
    chooseMove,
    clearMoveAnimation,
    clearParkillerAnimation,
  }
}
