import { useEffect, useState } from 'react'
import type { PlayerState } from '../core/gameFlow/playerState'
import type { TurnManager } from '../core/gameFlow/turnManager'
import type { Piece } from '../core/pieces/piece'
import type { MoveOption } from '../core/rules/moveOption'
import { snapshotPiece, type PieceSnapshot } from '../scene/piecePosition'

export interface MoveAnimationRequest {
  piece: Piece
  before: PieceSnapshot
  after: PieceSnapshot
}

export function useTurnManager(turnManager: TurnManager) {
  const [currentPlayer, setCurrentPlayer] = useState<PlayerState>(turnManager.currentPlayer)
  const [lastRoll, setLastRoll] = useState<number | null>(null)
  const [rolling, setRolling] = useState(false)
  const [pendingMoves, setPendingMoves] = useState<MoveOption[]>([])
  const [winner, setWinner] = useState<PlayerState | null>(null)
  const [moveAnimation, setMoveAnimation] = useState<MoveAnimationRequest | null>(null)

  useEffect(() => {
    const unsubscribers = [
      turnManager.turnStarted.on((player) => {
        setCurrentPlayer(player)
        setPendingMoves([])
      }),
      turnManager.diceRolled.on((roll) => {
        setLastRoll(roll)
        setRolling(false)
      }),
      turnManager.moveChoicesReady.on((moves) => setPendingMoves(moves)),
      turnManager.moveNotPossible.on(() => setPendingMoves([])),
      turnManager.moveApplied.on(() => setPendingMoves([])),
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
    turnManager.submitMove(piece) // mutates `piece` synchronously - snapshot after read below is post-move
    const after = snapshotPiece(piece)
    setMoveAnimation({ piece, before, after })
  }

  function clearMoveAnimation() {
    setMoveAnimation(null)
  }

  return { currentPlayer, lastRoll, rolling, pendingMoves, winner, moveAnimation, rollDice, chooseMove, clearMoveAnimation }
}
