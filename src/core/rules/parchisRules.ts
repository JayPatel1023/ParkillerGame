import type { BoardData } from '../board/boardData'
import type { PlayerState } from '../gameFlow/playerState'
import type { Piece } from '../pieces/piece'
import type { MoveOption, MoveResult } from './moveOption'
import type { RuleSettings } from './ruleSettings'

function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

export function getValidMoves(
  board: BoardData,
  player: PlayerState,
  roll: number,
  settings: RuleSettings,
): MoveOption[] {
  const lane = board.lanes[player.color]
  if (!lane) return []

  const moves: MoveOption[] = []

  for (const piece of player.pieces) {
    if (piece.state === 'Finished') continue

    if (piece.state === 'InYard') {
      if (roll === settings.entryRoll) {
        moves.push({
          piece,
          kind: 'ExitYard',
          resultingTrackPosition: lane.entryTrackIndex,
          resultingCorridorPosition: -1,
        })
      }
      continue
    }

    if (piece.state === 'OnTrack') {
      const distanceToHomeEntrance = mod(lane.homeEntranceTrackIndex - piece.trackPosition, board.trackLength)
      const totalStepsToFinish = distanceToHomeEntrance + lane.corridorLength

      if (roll > totalStepsToFinish) continue // overshoot past home - exact count required

      if (roll <= distanceToHomeEntrance) {
        const newTrackPos = (piece.trackPosition + roll) % board.trackLength
        moves.push({ piece, kind: 'TrackMove', resultingTrackPosition: newTrackPos, resultingCorridorPosition: -1 })
      } else {
        const corridorIndex = roll - distanceToHomeEntrance - 1
        const kind = corridorIndex === lane.corridorLength - 1 ? 'FinishMove' : 'CorridorMove'
        moves.push({ piece, kind, resultingTrackPosition: -1, resultingCorridorPosition: corridorIndex })
      }
      continue
    }

    if (piece.state === 'InHomeCorridor') {
      const newCorridorPos = piece.corridorPosition + roll
      if (newCorridorPos > lane.corridorLength - 1) continue // overshoot - exact count required

      const kind = newCorridorPos === lane.corridorLength - 1 ? 'FinishMove' : 'CorridorMove'
      moves.push({ piece, kind, resultingTrackPosition: -1, resultingCorridorPosition: newCorridorPos })
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
  const result: MoveResult = { movedPiece: piece, capturedPiece: null, pieceFinished: false }

  switch (move.kind) {
    case 'ExitYard':
    case 'TrackMove':
      piece.state = 'OnTrack'
      piece.trackPosition = move.resultingTrackPosition
      piece.corridorPosition = -1
      result.capturedPiece = settings.captureSendsToYard
        ? captureAt(board, piece, move.resultingTrackPosition, allPlayers)
        : null
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
