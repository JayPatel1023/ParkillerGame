import { useEffect, useState } from 'react'
import type { PlayerState } from '../core/gameFlow/playerState'
import type { DiceRoll, RewardGrant, TurnManager } from '../core/gameFlow/turnManager'
import type { Piece } from '../core/pieces/piece'
import type { MoveOption } from '../core/rules/moveOption'
import { snapshotPiece, type PieceSnapshot } from '../scene/piecePosition'

export interface MoveAnimationRequest {
  piece: Piece
  before: PieceSnapshot
  after: PieceSnapshot
  /**
   * The opponent piece this move captured, if any. Rules apply a capture the instant the move is
   * submitted (the captured piece's own state flips to InYard right away, same as everything
   * else), but visually it should stay put until the capturing piece's hop animation actually
   * arrives - see BoardScene, which keeps rendering this piece at the capture square for as long
   * as `moveAnimation` names it here, only letting it snap home once the animation completes.
   */
  capturedPiece: Piece | null
}

export function useTurnManager(turnManager: TurnManager) {
  const [currentPlayer, setCurrentPlayer] = useState<PlayerState>(turnManager.currentPlayer)
  const [lastRoll, setLastRoll] = useState<DiceRoll | null>(null)
  const [rolling, setRolling] = useState(false)
  const [pendingMoves, setPendingMoves] = useState<MoveOption[]>([])
  const [winner, setWinner] = useState<PlayerState | null>(null)
  const [moveAnimation, setMoveAnimation] = useState<MoveAnimationRequest | null>(null)
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
      turnManager.moveChoicesReady.on((moves) => setPendingMoves(moves)),
      turnManager.moveNotPossible.on(() => setPendingMoves([])),
      turnManager.moveApplied.on(() => {
        setPendingMoves([])
        // Cleared here and re-set by rewardOffered/rewardForfeited if this move earned another one -
        // both happen synchronously within the same submitMove call, so React batches them together.
        setPendingReward(null)
      }),
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
    const before = snapshotPiece(piece)
    const result = turnManager.submitMove(piece) // mutates `piece` synchronously - after-snapshot below is post-move
    const after = snapshotPiece(piece)
    setMoveAnimation({ piece, before, after, capturedPiece: result?.capturedPiece ?? null })
  }

  function clearMoveAnimation() {
    setMoveAnimation(null)
  }

  return {
    currentPlayer,
    lastRoll,
    rolling,
    pendingMoves,
    winner,
    moveAnimation,
    eliminatedByDoubles,
    pendingReward,
    forfeitedReward,
    rollDice,
    chooseMove,
    clearMoveAnimation,
  }
}
