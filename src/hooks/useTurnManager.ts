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
        setLastRoll(roll)
        setRolling(false)
        setEliminatedByDoubles(null)
        setPendingReward(null)
        setForfeitedReward(null)
      }),
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
    setRolling(true)
    // Brief spin before resolving, purely for feel - the roll value/result is already deterministic.
    setTimeout(() => turnManager.requestRoll(), 450)
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
