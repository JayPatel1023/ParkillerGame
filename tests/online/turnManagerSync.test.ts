import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardData } from '../../src/core/board/boardData'
import { createPlayerState, type PlayerState } from '../../src/core/gameFlow/playerState'
import { TurnManager } from '../../src/core/gameFlow/turnManager'
import type { DiceLike } from '../../src/core/dice'
import type { PieceColor } from '../../src/core/pieceColor'
import { createPiece } from '../../src/core/pieces/piece'
import type { MoveResult } from '../../src/core/rules/moveOption'
import { defaultRuleSettings } from '../../src/core/rules/ruleSettings'
import { RecordingDice, QueueDice } from '../../src/online/dice'
import type { GameMessage } from '../../src/online/protocol'
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
  // RemoteTurnManager now paces its own broadcast replay (REMOTE_MOVE_PACING_MS - reported
  // directly, "no es fácil seguir el juego si va tan rápido") instead of applying every incoming
  // message synchronously the instant it arrives - real time has to actually pass for its queue to
  // drain before asserting convergence below.
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

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

    // Generous - well past REMOTE_MOVE_PACING_MS, draining however many broadcasts this move
    // chain actually produced.
    vi.advanceTimersByTime(20000)
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

    // Generous - well past REMOTE_MOVE_PACING_MS, draining every broadcast this whole sequence
    // (Red's exit, Red's second move, and Blue's own roll) actually produced.
    vi.advanceTimersByTime(20000)
    expect(snapshot(remote.players)).toEqual(snapshot(host.players))
  })

  // Reported directly, with video: a pawn that had just moved visibly reverted to its starting
  // square for a couple of seconds while the next roll was already in progress, then caught up.
  // Root cause: RemoteTurnManager used to pace every replayed broadcast by a flat
  // REMOTE_MOVE_PACING_MS, regardless of how far the move it just replayed actually walked - a
  // long enough move takes amount*480ms to animate, which can exceed even the current 20000ms
  // floor for a very large amount, so the next broadcast (here, the next player's own roll) got
  // replayed before the previous move's hop had actually finished playing. This drives a real
  // 10-square move through the sync layer and checks that the *following* roll is held back for at
  // least the move's own correctly-budgeted window, not applied early.
  it("paces a long move's replay by its own real hop duration, not just the flat floor, before the next roll replays", () => {
    const board = buildTestBoard()
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const actorColors = new Map<number, PieceColor>([
      [MASTER_ACTOR, 'Red'],
      [REMOTE_ACTOR, 'Blue'],
    ])
    // dieA=6/dieB=4: no double (no bonus turn to complicate the sequence), neither value is the
    // default exitRoll (5), so no yard-exit obligation interferes - the sum (10) is a completely
    // free, single-piece choice that consumes both dice and ends Red's turn in one move.
    const host = buildHost(board, network, actorColors, [6, 4, 1, 2, 2, 1])
    const remote = buildRemote(board, network)
    host.players[0].pieces[0].state = 'OnTrack'
    host.players[0].pieces[0].trackPosition = 0
    remote.players[0].pieces[0].state = 'OnTrack'
    remote.players[0].pieces[0].trackPosition = 0
    host.bridge.start()
    remote.bridge.start()

    let rollCount = 0
    remote.bridge.diceRolled.on(() => rollCount++)

    let moves: import('../../src/core/rules/moveOption').MoveOption[] = []
    host.bridge.moveChoicesReady.on((m) => (moves = m))
    host.bridge.requestRoll() // broadcasts diceRolled for Red
    const sumMove = moves.find((m) => m.amount === 10)
    expect(sumMove).toBeTruthy()
    host.bridge.submitMove(sumMove!.piece, 10) // broadcasts moveChosen amount=10 - ends Red's turn

    expect(host.bridge.currentPlayer.color).toBe('Blue')
    // Blue's own roll has to come from the Remote side (sendToMaster -> validated -> broadcast) -
    // host.bridge only ever acts as the Master's own seat (Red), so a direct host.bridge.requestRoll()
    // here would silently be rejected as the wrong actor for the current turn.
    remote.bridge.requestRoll()

    vi.advanceTimersByTime(50) // drains the queue's first message (wait=0): Red's own diceRolled replays
    expect(rollCount).toBe(1)

    // Red's own diceRolled fired at (virtual) t=0 - the very first drain of a fresh queue always
    // waits 0ms, regardless of how far the 50ms advance above actually moved the clock - and
    // budgets REMOTE_MOVE_PACING_MS + PARKI_REVEAL_HOLD_MS + blackDie(1)*HOP_DURATION_MS =
    // 2000+2000+480 = 4480ms before the next queued message (the move) may replay - due at
    // t=0+4480=4480. That move then budgets max(REMOTE_MOVE_PACING_MS, 10*480=4800)=4800ms before
    // the one after it (Blue's own roll) may replay - due at t=4480+4800=9280. Advancing to just
    // short of that (t=9250) proves the move itself already replayed but Blue's roll correctly
    // hasn't yet.
    vi.advanceTimersByTime(9250 - 50)
    expect(rollCount).toBe(1)
    expect(remote.players[0].pieces[0].trackPosition).toBe(10) // the long move itself did replay by now

    vi.advanceTimersByTime(100) // past t=9280
    expect(rollCount).toBe(2) // Blue's roll only replays once the move's own real duration has passed
  })

  // Reported again, separately, still with the same "reverts to its start square" symptom, even
  // after the long-move fix just above shipped: an *ordinary* capture (not self-elimination)
  // still under-budgeted its own extra bounce time. Root cause: applyMessage's own extraBounceMs
  // only checked result.eliminatedByParkiller, never result.capturedPiece - but BoardScene.tsx
  // feeds a captured pawn's own "flung home" bounce (captureFlight) the exact same diceSettledAt
  // gate a plain hop uses (see PieceMesh.tsx's own hopFrom hold), so under-budgeting it here let
  // the next queued broadcast re-arm that gate while the victim's own bounce was still genuinely
  // playing. Matches botController.ts's own equivalent human-move listener, which already checks
  // `result.eliminatedByParkiller || result.capturedPiece` for exactly this reason. Exercises
  // applyMessage directly (not through a full capture setup) so the pacing math itself is pinned
  // down precisely, independent of whatever board/rules scenario happens to produce a capture.
  it("budgets a captured pawn's own bounce-home time too, not just a self-elimination's, before the next broadcast replays", () => {
    const board = buildTestBoard()
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const remote = buildRemote(board, network)
    const capturedPiece = createPiece('Blue', 0)

    // Stubs the inner TurnManager's own submitMove so the returned MoveResult is pinned down
    // exactly (an ordinary capture, amount=6, not a self-elimination) rather than depending on a
    // real board/rules setup happening to produce one.
    const fakeResult: MoveResult = {
      movedPiece: remote.players[0].pieces[0],
      amount: 6,
      capturedPiece,
      capturedParkillerColor: null,
      pieceFinished: false,
      eliminatedByParkiller: false,
    }
    const remoteInternals = remote.bridge as unknown as { inner: TurnManager; applyMessage(msg: GameMessage): number }
    remoteInternals.inner.submitMove = () => fakeResult

    const msg: GameMessage = { type: 'moveChosen', color: 'Red', pieceIndex: 0, amount: 6 }
    const waitMs = remoteInternals.applyMessage(msg)

    const HOP_DURATION_MS = 480
    const CAPTURE_RETURN_HOPS = 3
    // Not just >= REMOTE_MOVE_PACING_MS (2000) - the fixed budget has to actually include the
    // captured piece's own bounce-home time on top of the mover's own plain hop.
    expect(waitMs).toBeGreaterThanOrEqual(6 * HOP_DURATION_MS + CAPTURE_RETURN_HOPS * HOP_DURATION_MS)
  })

  // Reported a third time, still the same "reverts to its start square" symptom, after both fixes
  // above had already shipped: the *Parkiller's* own automatic move - not a pawn's own move - can
  // itself capture an opposing pawn or Parkiller (PK5/PK6, the same rule as the self-elimination
  // case above, just the other direction). That capture plays the identical captureFlights
  // bounce-home BoardScene.tsx spawns for any other capture, but the 'diceRolled' branch used to
  // budget only msg.blackDie's own hop distance, with no way to know whether that hop actually
  // captured anything. Exercises applyMessage directly, same reasoning as the test just above.
  it("budgets the Parkiller's own automatic capture bounce-home time too, before the next broadcast replays", () => {
    const board = buildTestBoard()
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const remote = buildRemote(board, network)
    const capturedPawn = createPiece('Blue', 0)

    // Stubs the inner TurnManager's own requestRoll so the Parkiller's own move outcome is pinned
    // down exactly (captured a pawn) rather than depending on a real board/rules setup happening to
    // produce one - requestRoll() itself would normally resolve+emit parkillerMoved synchronously
    // (see RemoteTurnManager's own doc comment on lastParkillerResult for why this fires it
    // directly rather than replaying a real roll).
    const remoteInternals = remote.bridge as unknown as { inner: TurnManager; applyMessage(msg: GameMessage): number }
    remoteInternals.inner.requestRoll = () => {
      remote.bridge.parkillerMoved.emit({
        color: 'Red',
        before: 3,
        after: 3,
        beforeCorridorPosition: 6,
        afterCorridorPosition: 6,
        capturedPawn,
        capturedParkillerColor: null,
      })
    }

    const msg: GameMessage = { type: 'diceRolled', dieA: 1, dieB: 1, blackDie: 3 }
    const waitMs = remoteInternals.applyMessage(msg)

    const REMOTE_MOVE_PACING_MS = 2000
    const PARKI_REVEAL_HOLD_MS = 2000
    const HOP_DURATION_MS = 480
    const CAPTURE_RETURN_HOPS = 3
    // Not just the Parkiller's own hop distance (blackDie=3) - the fixed budget has to actually
    // include the captured pawn's own bounce-home time on top of it.
    expect(waitMs).toBeGreaterThanOrEqual(REMOTE_MOVE_PACING_MS + PARKI_REVEAL_HOLD_MS + 3 * HOP_DURATION_MS + CAPTURE_RETURN_HOPS * HOP_DURATION_MS)
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
