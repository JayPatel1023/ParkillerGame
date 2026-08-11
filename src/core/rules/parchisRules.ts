import type { BoardData } from '../board/boardData'
import type { PlayerState } from '../gameFlow/playerState'
import type { PieceColor } from '../pieceColor'
import type { Piece } from '../pieces/piece'
import type { DiceSource, MoveOption, MoveResult } from './moveOption'
import type { RuleSettings } from './ruleSettings'

function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

// `amount` is a single usable step count - the caller (TurnManager) decides whether that's one
// die's face value or the sum of both, and passes `diceSource` along purely so the resulting
// MoveOption records which of this roll's dice it would spend. This function itself has no
// concept of "two dice" - it just answers "what can move by this many steps", the same question
// regardless of where the number came from.
export function getValidMoves(
  board: BoardData,
  player: PlayerState,
  amount: number,
  settings: RuleSettings,
  diceSource: DiceSource = 'sum',
): MoveOption[] {
  const lane = board.lanes[player.color]
  if (!lane) return []

  const moves: MoveOption[] = []

  for (const piece of player.pieces) {
    if (piece.state === 'Finished') continue

    if (piece.state === 'InYard') {
      if (amount === settings.exitRoll) {
        moves.push({
          piece,
          kind: 'ExitYard',
          resultingTrackPosition: lane.entryTrackIndex,
          resultingCorridorPosition: -1,
          amount,
          diceSource,
        })
      }
      continue
    }

    if (piece.state === 'OnTrack') {
      const distanceToHomeEntrance = mod(lane.homeEntranceTrackIndex - piece.trackPosition, board.trackLength)
      const totalStepsToFinish = distanceToHomeEntrance + lane.corridorLength

      if (amount > totalStepsToFinish) continue // overshoot past home - exact count required

      if (amount <= distanceToHomeEntrance) {
        const newTrackPos = (piece.trackPosition + amount) % board.trackLength
        moves.push({
          piece,
          kind: 'TrackMove',
          resultingTrackPosition: newTrackPos,
          resultingCorridorPosition: -1,
          amount,
          diceSource,
        })
      } else {
        const corridorIndex = amount - distanceToHomeEntrance - 1
        const kind = corridorIndex === lane.corridorLength - 1 ? 'FinishMove' : 'CorridorMove'
        moves.push({ piece, kind, resultingTrackPosition: -1, resultingCorridorPosition: corridorIndex, amount, diceSource })
      }
      continue
    }

    if (piece.state === 'InHomeCorridor') {
      const newCorridorPos = piece.corridorPosition + amount
      if (newCorridorPos > lane.corridorLength - 1) continue // overshoot - exact count required

      const kind = newCorridorPos === lane.corridorLength - 1 ? 'FinishMove' : 'CorridorMove'
      moves.push({ piece, kind, resultingTrackPosition: -1, resultingCorridorPosition: newCorridorPos, amount, diceSource })
    }
  }

  return moves
}

export function applyMove(
  board: BoardData,
  move: MoveOption,
  allPlayers: readonly PlayerState[],
  settings: RuleSettings,
): MoveResult {
  const piece = move.piece
  const result: MoveResult = { movedPiece: piece, capturedPiece: null, capturedParkillerColor: null, pieceFinished: false }

  switch (move.kind) {
    case 'ExitYard':
    case 'TrackMove':
      piece.state = 'OnTrack'
      piece.trackPosition = move.resultingTrackPosition
      piece.corridorPosition = -1
      result.capturedPiece = settings.captureSendsToYard
        ? captureAt(board, piece, move.resultingTrackPosition, allPlayers)
        : null
      result.capturedParkillerColor = captureParkillerAt(piece, move.resultingTrackPosition, allPlayers)
      break

    case 'CorridorMove':
      piece.state = 'InHomeCorridor'
      piece.trackPosition = -1
      piece.corridorPosition = move.resultingCorridorPosition
      break

    case 'FinishMove':
      piece.state = 'Finished'
      piece.trackPosition = -1
      piece.corridorPosition = move.resultingCorridorPosition
      result.pieceFinished = true
      break
  }

  return result
}

function captureAt(
  board: BoardData,
  mover: Piece,
  trackPosition: number,
  allPlayers: readonly PlayerState[],
): Piece | null {
  if (board.safeTrackIndices.has(trackPosition)) return null

  for (const opponent of allPlayers) {
    if (opponent.color === mover.color) continue
    for (const opponentPiece of opponent.pieces) {
      if (opponentPiece.state === 'OnTrack' && opponentPiece.trackPosition === trackPosition) {
        opponentPiece.state = 'InYard'
        opponentPiece.trackPosition = -1
        return opponentPiece
      }
    }
  }

  return null
}

// PK6: landing exactly on an opposing color's Parkiller eliminates it permanently (unlike a
// regular pawn, it doesn't go back to a yard - it's simply out for the rest of the game). Not
// restricted by safeTrackIndices - the rulebook only protects a Parkiller's *target* pawn from
// the Parkiller itself (PK5), not the Parkiller from being caught by a pawn.
function captureParkillerAt(mover: Piece, trackPosition: number, allPlayers: readonly PlayerState[]): PieceColor | null {
  for (const opponent of allPlayers) {
    if (opponent.color === mover.color) continue
    if (opponent.parkiller.state === 'InPlay' && opponent.parkiller.trackPosition === trackPosition) {
      opponent.parkiller.state = 'Eliminated'
      return opponent.color
    }
  }
  return null
}
