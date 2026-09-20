import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardData } from '../../src/core/board/boardData'
import { createPlayerState, type PlayerState } from '../../src/core/gameFlow/playerState'
import { TurnManager } from '../../src/core/gameFlow/turnManager'
import type { DiceLike } from '../../src/core/dice'
import type { PieceColor } from '../../src/core/pieceColor'
import { defaultRuleSettings } from '../../src/core/rules/ruleSettings'
import { QueueDice, RecordingDice } from '../../src/online/dice'
import { HostTurnManagerBridge } from '../../src/online/HostTurnManagerBridge'
import { RemoteTurnManager } from '../../src/online/RemoteTurnManager'
import { FakeRoomNetwork } from './fakeRoomTransport'

const MASTER_ACTOR = 1
const REMOTE_ACTOR = 2

class ScriptedDice implements DiceLike {
  private queue: number[]
  constructor(queue: number[]) {
    this.queue = [...queue]
  }
  roll(): number {
    const next = this.queue.shift()
    if (next === undefined) throw new Error('ScriptedDice ran out of scripted rolls')
    return next
  }
}

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

function snapshot(players: PlayerState[]) {
  return players.map((p) => ({
    color: p.color,
    pieces: p.pieces.map((piece) => ({ state: piece.state, trackPosition: piece.trackPosition, corridorPosition: piece.corridorPosition })),
    parkiller: { state: p.parkiller.state, trackPosition: p.parkiller.trackPosition },
  }))
}

// Covers the client's own request, confirmed directly after a follow-up question: "Debe poder ser
// reemplazado por el bot hasta que tome el control en la siguiente tirada" (a departed Master
// should also be replaceable by a bot, not end the game) - OnlineLobbyScreen.tsx's own
// promoteToMaster() reuses the surviving client's *exact* TurnManager instance (already correctly
// synced by replaying every broadcast so far) rather than building a fresh one, swapping in a real
// RecordingDice via TurnManager.replaceDice() and wrapping it in a fresh HostTurnManagerBridge.
// This test exercises that exact sequence directly (no React/Photon involved) to prove state -
// whose turn it is, piece positions - survives the handoff intact, and that the promoted bridge
// keeps working correctly afterward.
describe('online master promotion (a surviving Remote takes over authority)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a promoted Remote continues the exact same game state, not a fresh one, and keeps playing correctly', () => {
    const board = buildTestBoard()

    // --- Original Master (actor 1) ---
    const masterPlayers = [createPlayerState('Red', board), createPlayerState('Blue', board)]
    const masterDice = new RecordingDice(new ScriptedDice([2, 3, 1, 2, 3, 1]))
    const masterInner = new TurnManager(board, masterPlayers, defaultRuleSettings(), masterDice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const masterTransport = network.createTransport(MASTER_ACTOR)
    const actorColors = new Map<number, PieceColor>([
      [MASTER_ACTOR, 'Red'],
      [REMOTE_ACTOR, 'Blue'],
    ])
    const masterBridge = new HostTurnManagerBridge(masterInner, masterDice, masterPlayers, masterTransport, actorColors, 'Red')

    // --- Surviving Remote (actor 2, Blue's own seat) - mirrors startAsRemote() exactly ---
    const remotePlayers = [createPlayerState('Red', board), createPlayerState('Blue', board)]
    const remoteDiceQueue = new QueueDice()
    const remoteInner = new TurnManager(board, remotePlayers, defaultRuleSettings(), remoteDiceQueue)
    const remoteTransport = network.createTransport(REMOTE_ACTOR)
    const remoteBridge = new RemoteTurnManager(remoteInner, remoteDiceQueue, remotePlayers, remoteTransport, 'Blue')

    masterBridge.start()
    // Red exits via the sum (2+3=5) - both dice spent at once, turn passes cleanly to Blue.
    masterBridge.requestRoll()
    vi.advanceTimersByTime(20000) // drains the Remote's own paced replay queue
    masterBridge.submitMove(masterPlayers[0].pieces[0], 5)
    vi.advanceTimersByTime(20000)
    // Blue's own turn - sent as a genuine remote intent (Blue's own seat, actor 2), same as a real
    // non-Master player's click would be, not called directly on masterBridge (which always acts as
    // the Master's *own* seat, Red here, and would otherwise be silently rejected as "not your
    // turn"). The Master replays it into its own state and re-broadcasts, same as any other move.
    remoteBridge.requestRoll()
    vi.advanceTimersByTime(20000)
    remoteBridge.submitMove(remotePlayers[1].pieces[0], 5)
    vi.advanceTimersByTime(20000)

    // Both sides must agree before the handoff - proves the Remote really was staying in sync.
    expect(snapshot(remotePlayers)).toEqual(snapshot(masterPlayers))
    expect(remoteInner.currentPlayer.color).toBe(masterInner.currentPlayer.color)
    expect(remoteInner.currentPlayer.color).toBe('Red')

    // --- "The Master disconnects" - nothing more is ever broadcast from it. The Remote (actor 2)
    // gets promoted: reuse remoteInner exactly as-is, just give it a real dice source. ---
    const newDice = new RecordingDice(new ScriptedDice([1, 2, 1]))
    remoteInner.replaceDice(newDice)
    const promotedBridge = new HostTurnManagerBridge(remoteInner, newDice, remotePlayers, remoteTransport, actorColors, 'Blue')

    // State survived the handoff untouched - still Red's own turn (never reset to turn 0), and
    // every piece is exactly where it already was (Red and Blue each one exited pawn at their own
    // entry square, not back in the yard).
    expect(promotedBridge.currentPlayer.color).toBe('Red')
    expect(snapshot(remotePlayers)).toEqual(snapshot(masterPlayers))
    expect(remotePlayers[0].pieces[0].trackPosition).toBe(0)
    expect(remotePlayers[1].pieces[0].trackPosition).toBe(10)

    // It's Red's own turn, and Red's own actor (the one that just disconnected) is gone - exactly
    // the case promoteToMaster() immediately hands to BotController.takeOverColor() in the real
    // app. Simulated directly here via rollForBot()/submitMoveForBot() (bypasses actor-ownership
    // validation, same as a real bot) - proves the promoted bridge keeps working correctly from a
    // real dice source, moving Red's already-exited piece from wherever it already was (0), not
    // from some reset state.
    promotedBridge.rollForBot()
    const moved = promotedBridge.submitMoveForBot(remotePlayers[0].pieces[0], 3)
    expect(moved).not.toBeNull()
    expect(remotePlayers[0].pieces[0].trackPosition).toBe(3)
  })
})
