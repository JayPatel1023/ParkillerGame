import type { BoardData } from '../board/boardData'
import type { PlayerState } from '../gameFlow/playerState'
import type { PieceColor } from '../pieceColor'
import type { Piece } from '../pieces/piece'
import type { DiceSource, MoveOption, MoveResult } from './moveOption'
import type { RuleSettings } from './ruleSettings'

function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

// PC2 ("There can never be more than two pawns per square") / PC2.4 (barriers): verified directly
// against the client's own reference implementation - a track square with 2 pieces already on it
// (regardless of color) blocks every other piece from landing there OR passing through it as an
// intermediate step of a longer move. The Parkiller is exempt from this entirely (PK4: "the
// Parkiller can jump over barriers") - it never goes through getValidMoves, it's resolved
// separately in TurnManager.
function piecesOnTrackSquare(allPlayers: readonly PlayerState[], trackPosition: number): number {
  let count = 0
  for (const player of allPlayers) {
    for (const piece of player.pieces) {
      if (piece.state === 'OnTrack' && piece.trackPosition === trackPosition) count++
    }
  }
  return count
}

// Home-corridor squares are private to one color (no opponent piece can ever enter another
// color's corridor), so occupancy here is just "how many of my own pieces already sit here" - the
// reference implementation caps every corridor square but the true final one at 1 piece; the final
// square allows all 4 to stack freely once finished.
function ownPiecesInCorridor(allPlayers: readonly PlayerState[], color: PieceColor, corridorPosition: number): number {
  let count = 0
  for (const player of allPlayers) {
    if (player.color !== color) continue
    for (const piece of player.pieces) {
      if (piece.state === 'InHomeCorridor' && piece.corridorPosition === corridorPosition) count++
    }
  }
  return count
}

// `amount` is a single usable step count - the caller (TurnManager) decides whether that's one
// die's face value or the sum of both, and passes `diceSource` along purely so the resulting
// MoveOption records which of this roll's dice it would spend. This function itself has no
// concept of "two dice" - it just answers "what can move by this many steps", the same question
// regardless of where the number came from.
export function getValidMoves(
  board: BoardData,
  player: PlayerState,
  allPlayers: readonly PlayerState[],
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
        // Exiting still has to land somewhere legal - the entry square follows the exact same
        // barrier/occupancy rule as any other track square.
        if (piecesOnTrackSquare(allPlayers, lane.entryTrackIndex) < 2) {
          moves.push({
            piece,
            kind: 'ExitYard',
            resultingTrackPosition: lane.entryTrackIndex,
            resultingCorridorPosition: -1,
            amount,
            diceSource,
          })
        }
      }
      continue
    }

    if (piece.state === 'OnTrack') {
      const distanceToHomeEntrance = mod(lane.homeEntranceTrackIndex - piece.trackPosition, board.trackLength)
      const totalStepsToFinish = distanceToHomeEntrance + lane.corridorLength

      if (amount > totalStepsToFinish) continue // overshoot past home - exact count required

      // PC2.4: a barrier blocks passage, not just landing - walk every square this move crosses
      // (not the final one, checked separately below with its own landing rules).
      let blockedInTransit = false
      for (let step = 1; step < amount; step++) {
        const intermediatePos = (piece.trackPosition + step) % board.trackLength
        if (piecesOnTrackSquare(allPlayers, intermediatePos) >= 2) {
          blockedInTransit = true
          break
        }
      }
      if (blockedInTransit) continue

      if (amount <= distanceToHomeEntrance) {
        const newTrackPos = (piece.trackPosition + amount) % board.trackLength
        if (piecesOnTrackSquare(allPlayers, newTrackPos) >= 2) continue
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
        const isFinal = corridorIndex === lane.corridorLength - 1
        if (!isFinal && ownPiecesInCorridor(allPlayers, player.color, corridorIndex) >= 1) continue
        const kind = isFinal ? 'FinishMove' : 'CorridorMove'
        moves.push({ piece, kind, resultingTrackPosition: -1, resultingCorridorPosition: corridorIndex, amount, diceSource })
      }
      continue
    }

    if (piece.state === 'InHomeCorridor') {
      const newCorridorPos = piece.corridorPosition + amount
      if (newCorridorPos > lane.corridorLength - 1) continue // overshoot - exact count required

      const isFinal = newCorridorPos === lane.corridorLength - 1
      if (!isFinal && ownPiecesInCorridor(allPlayers, player.color, newCorridorPos) >= 1) continue
      const kind = isFinal ? 'FinishMove' : 'CorridorMove'
      moves.push({ piece, kind, resultingTrackPosition: -1, resultingCorridorPosition: newCorridorPos, amount, diceSource })
    }
  }

  return moves
}

// PC3/PK8: capturing is mandatory whenever available, not just one option among others - a player
// can't dodge an available capture by choosing to move a different piece instead. TurnManager uses
// this to filter its offered moves down to only the capturing ones whenever any exist. Pure/
// read-only (no mutation), so it can be checked before a move is actually applied.
export function wouldCapture(
  board: BoardData,
  move: MoveOption,
  allPlayers: readonly PlayerState[],
  allowParkillerCapture: boolean,
): boolean {
  if (move.kind !== 'ExitYard' && move.kind !== 'TrackMove') return false
  const pos = move.resultingTrackPosition

  // PK6: "Se mueve con la cifra de un dado el peón que elimina al Parkiller" - the capturing move
  // must spend a single die's own face value, not the sum of both. A double's sum landing on the
  // Parkiller's square doesn't count, even though the same double's individual die value might.
  const usesSingleDie = move.diceSource === 'dieA' || move.diceSource === 'dieB'
  for (const opponent of allPlayers) {
    if (opponent.color === move.piece.color) continue
    if (allowParkillerCapture && usesSingleDie && opponent.parkiller.state === 'InPlay' && opponent.parkiller.trackPosition === pos)
      return true
  }

  if (board.safeTrackIndices.has(pos)) return false
  for (const opponent of allPlayers) {
    if (opponent.color === move.piece.color) continue
    for (const opponentPiece of opponent.pieces) {
      if (opponentPiece.state === 'OnTrack' && opponentPiece.trackPosition === pos) return true
    }
  }
  return false
}

export function applyMove(
  board: BoardData,
  move: MoveOption,
  allPlayers: readonly PlayerState[],
  settings: RuleSettings,
  allowParkillerCapture: boolean,
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
      // PK6/PK8: a common piece only eliminates the Parkiller during the roll that just produced
      // doubles (the reference implementation's own doblete_mata_parkiller flag) - landing on it
      // any other time does nothing at all, verified directly against that source. And even on a
      // double, only a single die's own value counts, not their sum (see wouldCapture).
      const usesSingleDie = move.diceSource === 'dieA' || move.diceSource === 'dieB'
      result.capturedParkillerColor = allowParkillerCapture && usesSingleDie
        ? captureParkillerAt(piece, move.resultingTrackPosition, allPlayers)
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

// PK6: landing exactly on an opposing color's Parkiller eliminates it permanently (unlike a
// regular pawn, it doesn't go back to a yard - it's simply out for the rest of the game). Not
// restricted by safeTrackIndices - the rulebook only protects a Parkiller's *target* pawn from
// the Parkiller itself (PK5), not the Parkiller from being caught by a pawn. Callers already gate
// this on allowParkillerCapture (PK6/PK8) before calling it.
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
