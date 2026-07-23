import type { BoardDefinition } from '../board/boardDefinition'
import { toBoardData } from '../board/boardDefinition'
import type { PieceColor } from '../pieceColor'
import { defaultRuleSettings } from '../rules/ruleSettings'
import { createPlayerState, type PlayerState } from './playerState'
import { TurnManager } from './turnManager'

// Entry point for milestone 1: same-device hotseat play, 2-6 real players, no networking, no bots.
export function beginLocalGame(
  boardDefinition: BoardDefinition,
  participatingColors: PieceColor[],
): { turnManager: TurnManager; players: PlayerState[] } {
  const board = toBoardData(boardDefinition)
  const players = participatingColors.map(createPlayerState)
  const turnManager = new TurnManager(board, players, defaultRuleSettings())
  turnManager.start()
  return { turnManager, players }
}
