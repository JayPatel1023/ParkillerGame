import { describe, expect, it } from 'vitest'
import type { BoardData } from '../../src/core/board/boardData'
import { createPlayerState, type PlayerState } from '../../src/core/gameFlow/playerState'
import { TurnManager } from '../../src/core/gameFlow/turnManager'
import type { DiceLike } from '../../src/core/dice'
import type { PieceColor } from '../../src/core/pieceColor'
import { defaultRuleSettings } from '../../src/core/rules/ruleSettings'
import { RecordingDice, QueueDice } from '../../src/online/dice'
import { HostTurnManagerBridge } from '../../src/online/HostTurnManagerBridge'
import { RemoteTurnManager } from '../../src/online/RemoteTurnManager'
import { FakeRoomNetwork } from './fakeRoomTransport'

const MASTER_ACTOR = 1
const REMOTE_ACTOR = 2

// A fixed sequence instead of real Dice - the Master's own requestRoll() always acts as its own
// actor (Red here), so a real random roll that happens to offer no exit move would pass the turn
// to Blue and leave every further host.bridge.requestRoll() call correctly (and silently) rejected
// as "not your turn" - exactly the validation these bridges are supposed to enforce. Determinism
// sidesteps that entirely instead of retrying against real randomness.
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

// Every piece's full state - what "converged" actually means for these tests. Comparing this
// (not object identity, which is deliberately different between the two sides - see
// HostTurnManagerBridge's own comment) is exactly what proves the sync layer is correct.
function snapshot(players: PlayerState[]) {
  return players.map((p) => ({
    color: p.color,
    pieces: p.pieces.map((piece) => ({ state: piece.state, trackPosition: piece.trackPosition, corridorPosition: piece.corridorPosition })),
    parkiller: { state: p.parkiller.state, trackPosition: p.parkiller.trackPosition },
  }))
}

/** Builds one side (Master or Remote) of a synced pair - its own independent TurnManager +
 * players array (never shared with the other side - each simulates a genuinely separate client's
 * own local copy) wired to a fake transport. The Master's dice queue is scripted (it's the only
 * side that ever actually rolls); the Remote's QueueDice is fed only by replaying broadcasts. */
function buildHost(board: BoardData, network: FakeRoomNetwork, actorColors: Map<number, PieceColor>, rolls: number[]) {
  const players = [createPlayerState('Red', board), createPlayerState('Blue', board)]
  const dice = new RecordingDice(new ScriptedDice(rolls))
  const inner = new TurnManager(board, players, defaultRuleSettings(), dice)
  const transport = network.createTransport(MASTER_ACTOR)
  const bridge = new HostTurnManagerBridge(inner, dice, players, transport, actorColors)
  return { players, bridge }
}

function buildRemote(board: BoardData, network: FakeRoomNetwork) {
  const players = [createPlayerState('Red', board), createPlayerState('Blue', board)]
  const diceQueue = new QueueDice()
  const inner = new TurnManager(board, players, defaultRuleSettings(), diceQueue)
  const transport = network.createTransport(REMOTE_ACTOR)
  const bridge = new RemoteTurnManager(inner, diceQueue, players, transport)
  return { players, bridge }
}

// Reported directly ("debe de haber una tirada inicial para ver quien empieza" - there should be
// an initial roll to see who starts): online play never ran the pre-game starting-player roll-off
// local play already has - the Master's own seat, always first in `colors`, silently always went
// first. Mirrors OnlineLobbyScreen.tsx's own sequence exactly: the Master calls
// determineStartingPlayer() through a RecordingDice and drains its own recorded rolls (this is what
// gets broadcast in GameStartedMessage.startingPlayerRolls); every other client pushes those same
// values into its own QueueDice and replays determineStartingPlayer() against its own independent
// `players` array, rather than trusting a network-serialized result object directly.
describe('online starting-player roll-off sync', () => {
  it('a client replaying the same recorded rolls reaches the identical starting-player result', () => {
    const board = buildTestBoard()
    const hostPlayers = [createPlayerState('Red', board), createPlayerState('Blue', board)]
    const hostDice = new RecordingDice(new ScriptedDice([2, 2, 6, 6])) // Red 4, Blue 12 - no tie
    const hostInner = new TurnManager(board, hostPlayers, defaultRuleSettings(), hostDice)
    const hostResult = hostInner.determineStartingPlayer()
    const rolls = hostDice.drain()

    const remotePlayers = [createPlayerState('Red', board), createPlayerState('Blue', board)]
    const remoteDiceQueue = new QueueDice()
    remoteDiceQueue.push(...rolls)
    const remoteInner = new TurnManager(board, remotePlayers, defaultRuleSettings(), remoteDiceQueue)
    const remoteResult = remoteInner.determineStartingPlayer()

    expect(remoteResult).toEqual(hostResult)
    // Blue rolled higher (12 vs 4) - the room's own Master seat (always Red, first in `colors`)
    // does *not* automatically win, proving this is a genuine roll-off, not a relabeled default.
    expect(hostResult.winnerIndex).toBe(1)
    expect(hostInner.currentPlayer.color).toBe('Blue')
    expect(remoteInner.currentPlayer.color).toBe('Blue')
  })

  it('replays correctly even when the roll-off needed an extra tie-break round', () => {
    const board = buildTestBoard()
    const hostPlayers = [createPlayerState('Red', board), createPlayerState('Blue', board)]
    // Round 1: Red 3+3=6, Blue 1+5=6 - tied, re-roll. Round 2: Red 4+4=8, Blue 2+2=4 - Red wins.
    const hostDice = new RecordingDice(new ScriptedDice([3, 3, 1, 5, 4, 4, 2, 2]))
    const hostInner = new TurnManager(board, hostPlayers, defaultRuleSettings(), hostDice)
    const hostResult = hostInner.determineStartingPlayer()
    const rolls = hostDice.drain()

    expect(hostResult.rounds).toHaveLength(2)

    const remotePlayers = [createPlayerState('Red', board), createPlayerState('Blue', board)]
    const remoteDiceQueue = new QueueDice()
    remoteDiceQueue.push(...rolls)
    const remoteInner = new TurnManager(board, remotePlayers, defaultRuleSettings(), remoteDiceQueue)
    const remoteResult = remoteInner.determineStartingPlayer()

    expect(remoteResult).toEqual(hostResult)
  })
})

describe('HostTurnManagerBridge + RemoteTurnManager convergence', () => {
  it('a Master-initiated roll and move converge on both sides', () => {
    const board = buildTestBoard()
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const actorColors = new Map<number, PieceColor>([
      [MASTER_ACTOR, 'Red'],
      [REMOTE_ACTOR, 'Blue'],
    ])
    // dieA=5 exits a Red piece on the very first roll - no retry loop needed.
    const host = buildHost(board, network, actorColors, [5, 2, 1])
    const remote = buildRemote(board, network)
    host.bridge.start()
    remote.bridge.start()

    let moves: import('../../src/core/rules/moveOption').MoveOption[] = []
    host.bridge.moveChoicesReady.on((m) => (moves = m))
    host.bridge.requestRoll()
    expect(moves.length).toBeGreaterThan(0)

    host.bridge.submitMove(moves[0].piece)

    expect(snapshot(remote.players)).toEqual(snapshot(host.players))
  })

  it('a Remote-initiated roll and move converge on both sides', () => {
    const board = buildTestBoard()
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const actorColors = new Map<number, PieceColor>([
      [MASTER_ACTOR, 'Red'],
      [REMOTE_ACTOR, 'Blue'],
    ])
    // Red's first roll: dieA=5 exits a piece (not a double, so the sum-based combined dieA/dieB
    // spend below matches the real engine's own "spend one die, not both" behavior) - dieB=2 is
    // never actually consumed as a move here since ExitYard only spends dieA (amount===exitRoll
    // checked per-candidate; dieA=5 wins over dieB=2 and sum=7). That leaves dieB=2 still unspent
    // after the ExitYard move, so continueAfterMove() offers it again - use a piece placed by the
    // exit itself... simplest: just exit twice in a row isn't needed - only Red's turn needs to
    // resolve so play passes to Blue, however many rolls/moves that actually takes to settle here.
    const host = buildHost(board, network, actorColors, [5, 2, 1, 6, 6, 6])
    const remote = buildRemote(board, network)
    host.bridge.start()
    remote.bridge.start()

    let hostMoves: import('../../src/core/rules/moveOption').MoveOption[] = []
    host.bridge.moveChoicesReady.on((m) => (hostMoves = m))
    host.bridge.requestRoll() // dieA=5,dieB=2,blackDie=1 - exits a Red piece via dieA
    expect(hostMoves.length).toBeGreaterThan(0)
    host.bridge.submitMove(hostMoves[0].piece)
    // dieB=2 is still unspent - offerMoves() runs again immediately (continueAfterMove), no further
    // requestRoll() call needed; the just-exited piece (now at track index 0) can move 2 more.
    expect(hostMoves.length).toBeGreaterThan(0)
    host.bridge.submitMove(hostMoves[0].piece)

    expect(host.bridge.currentPlayer.color).toBe('Blue')

    remote.bridge.requestRoll() // sends rollIntent -> Master rolls [6,6,6] -> broadcasts -> both replay
    // 6,6 isn't Blue's exitRoll (5) and isn't a double-six-only-no-legal-move edge case here since
    // sum=12 also doesn't equal 5 - no legal move exists for an all-InYard Blue with this roll, so
    // moveNotPossible fires instead. That's fine - convergence is what's being tested, not that a
    // move actually happened. Assert state matches either way.

    expect(snapshot(remote.players)).toEqual(snapshot(host.players))
  })

  it("the Master rejects a roll intent from an actor whose seat isn't the current turn", () => {
    const board = buildTestBoard()
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    // Normal seat mapping - Red (Master) goes first by default (currentPlayerIndex starts at 0),
    // so Blue (Remote) trying to act immediately is exactly the "not your turn" case.
    const actorColors = new Map<number, PieceColor>([
      [MASTER_ACTOR, 'Red'],
      [REMOTE_ACTOR, 'Blue'],
    ])
    const host = buildHost(board, network, actorColors, [])
    host.bridge.start()
    expect(host.bridge.currentPlayer.color).toBe('Red')

    const before = snapshot(host.players)
    let broadcastCount = 0
    const remoteTransport = network.createTransport(REMOTE_ACTOR)
    remoteTransport.onMessage(() => broadcastCount++)

    remoteTransport.sendToMaster({ type: 'rollIntent' })

    expect(snapshot(host.players)).toEqual(before) // nothing changed - the intent was ignored
    expect(broadcastCount).toBe(0) // and nothing was broadcast either
  })
})
