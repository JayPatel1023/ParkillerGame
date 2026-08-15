import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardData } from '../../src/core/board/boardData'
import { createPlayerState } from '../../src/core/gameFlow/playerState'
import { TurnManager } from '../../src/core/gameFlow/turnManager'
import type { PieceColor } from '../../src/core/pieceColor'
import { defaultRuleSettings } from '../../src/core/rules/ruleSettings'
import { BotController } from '../../src/online/BotController'
import { RecordingDice } from '../../src/online/dice'
import { HostTurnManagerBridge } from '../../src/online/HostTurnManagerBridge'
import { FakeRoomNetwork } from './fakeRoomTransport'

const MASTER_ACTOR = 1

function buildTestBoard(): BoardData {
  return {
    playerCount: 2,
    trackLength: 20,
    lanes: {
      Red: { color: 'Red', entryTrackIndex: 0, homeEntranceTrackIndex: 19, corridorLength: 6 },
      Blue: { color: 'Blue', entryTrackIndex: 10, homeEntranceTrackIndex: 9, corridorLength: 6 },
    },
    safeTrackIndices: new Set([0, 10]),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BotController', () => {
  it('auto-plays every bot-assigned seat with no human/network input at all', () => {
    const board = buildTestBoard()
    const players = [createPlayerState('Red', board), createPlayerState('Blue', board)]
    const dice = new RecordingDice() // real randomness is fine here - bots just need *a* legal move to eventually appear
    const inner = new TurnManager(board, players, defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    // No actorColors entries at all - both seats are bots, nobody is a connected human actor.
    const host = new HostTurnManagerBridge(inner, dice, players, transport, new Map<number, PieceColor>())
    const bots = new BotController(host, new Set<PieceColor>(['Red', 'Blue']), 10)

    host.start()

    // Advance well past several rounds of "roll (10ms) -> move (10ms)" turns - the bots alone
    // should exit at least one piece each without anything else driving them.
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(15)
    }

    const redExited = players[0].pieces.some((p) => p.state !== 'InYard')
    const blueExited = players[1].pieces.some((p) => p.state !== 'InYard')
    expect(redExited).toBe(true)
    expect(blueExited).toBe(true)

    bots.dispose()
  })

  it('a color not in botColors never receives an automatic roll', () => {
    const board = buildTestBoard()
    const players = [createPlayerState('Red', board), createPlayerState('Blue', board)]
    const dice = new RecordingDice()
    const inner = new TurnManager(board, players, defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const host = new HostTurnManagerBridge(inner, dice, players, transport, new Map([[MASTER_ACTOR, 'Red' as PieceColor]]))
    // Only Blue is a bot - Red is the (human, unattended in this test) Master seat.
    const bots = new BotController(host, new Set<PieceColor>(['Blue']), 10)

    host.start()
    expect(host.currentPlayer.color).toBe('Red') // Red goes first and is not a bot

    for (let i = 0; i < 20; i++) vi.advanceTimersByTime(15)

    // Nothing should have moved - Red never auto-rolls, and Blue never gets a turn to auto-roll on.
    expect(players[0].pieces.every((p) => p.state === 'InYard')).toBe(true)
    expect(players[1].pieces.every((p) => p.state === 'InYard')).toBe(true)

    bots.dispose()
  })
})
