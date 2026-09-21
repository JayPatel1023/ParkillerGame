import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardData } from '../../src/core/board/boardData'
import type { DiceLike } from '../../src/core/dice'
import { createPlayerState } from '../../src/core/gameFlow/playerState'
import { TurnManager } from '../../src/core/gameFlow/turnManager'
import type { PieceColor } from '../../src/core/pieceColor'
import { defaultRuleSettings } from '../../src/core/rules/ruleSettings'
import { BotController } from '../../src/core/gameFlow/botController'
import { RecordingDice } from '../../src/online/dice'
import { HostTurnManagerBridge } from '../../src/online/HostTurnManagerBridge'
import { FakeRoomNetwork } from './fakeRoomTransport'

// Same technique as botController.test.ts's own ScriptedDice.
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

const MASTER_ACTOR = 1
const REMOTE_ACTOR = 2

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

// Covers the client's own request ("en vez de echarte deberías ser reemplazado por un bot hasta
// tomar de nuevo el control" - instead of kicking you out, you should be replaced by a bot until
// you take control again): OnlineLobbyScreen.tsx's own onActorLeft handler calls
// BotController.takeOverColor() for a real player's color once they've genuinely disconnected, and
// HostTurnManagerBridge's own onActorAction callback calls releaseColor() the instant that same
// actor genuinely acts again - these tests exercise both directions directly against a real
// HostTurnManagerBridge/BotController pair (FakeRoomNetwork, no actual Photon connection needed).
describe('BotController takeOverColor/releaseColor (idle/disconnect bot takeover)', () => {
  it('takeOverColor immediately plays out an already-pending roll decision for a real, actor-owned color', () => {
    const board = buildTestBoard()
    const players = [createPlayerState('Red', board), createPlayerState('Blue', board)]
    const dice = new RecordingDice(new ScriptedDice([5, 6, 1])) // dieA=5 is this board's own exit roll
    const inner = new TurnManager(board, players, defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    // Red is a real, connected actor (REMOTE_ACTOR) - not a bot seat from the lobby.
    const actorColors = new Map<number, PieceColor>([[REMOTE_ACTOR, 'Red']])
    const host = new HostTurnManagerBridge(inner, dice, players, transport, actorColors)
    // Starts with an *empty* botColors - Red is not bot-owned yet.
    const bots = new BotController(host, new Set<PieceColor>(), 10, 2, 2, 0, 0)

    host.start() // turnStarted(Red) - Red isn't bot-owned, so nothing gets scheduled from this alone
    vi.advanceTimersByTime(1000)
    expect(players[0].pieces.every((p) => p.state === 'InYard')).toBe(true) // still untouched

    bots.takeOverColor('Red')
    vi.advanceTimersByTime(10) // the roll itself (thinkDelayMs)
    vi.advanceTimersByTime(10) // the exit move that follows it

    expect(players[0].pieces.some((p) => p.state === 'OnTrack' && p.trackPosition === 0)).toBe(true)
  })

  it('takeOverColor immediately plays out an already-pending piece-choice decision', () => {
    const board = buildTestBoard()
    const players = [createPlayerState('Red', board), createPlayerState('Blue', board)]
    const dice = new RecordingDice(new ScriptedDice([5, 6, 1]))
    const inner = new TurnManager(board, players, defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const actorColors = new Map<number, PieceColor>([[REMOTE_ACTOR, 'Red']])
    const host = new HostTurnManagerBridge(inner, dice, players, transport, actorColors)
    const bots = new BotController(host, new Set<PieceColor>(), 10, 2, 2, 0, 0)

    host.start()
    // Rolled directly (bypassing actor validation, same as a bot's own roll would) - simulates the
    // roll having already happened (e.g. the player rolled, then went idle/disconnected before
    // picking a piece) *before* takeOverColor is ever called.
    host.rollForBot()
    expect(players[0].pieces.every((p) => p.state === 'InYard')).toBe(true) // rolled, not yet moved

    bots.takeOverColor('Red')
    vi.advanceTimersByTime(10) // the already-pending exit move

    expect(players[0].pieces.some((p) => p.state === 'OnTrack' && p.trackPosition === 0)).toBe(true)
  })

  it('a real player rolling for themselves right after reconnecting releases the color and cancels the bot\'s own already-scheduled roll, instead of rolling twice', () => {
    const board = buildTestBoard()
    const players = [createPlayerState('Red', board), createPlayerState('Blue', board)]
    const dice = new RecordingDice(new ScriptedDice([5, 6, 1]))
    const inner = new TurnManager(board, players, defaultRuleSettings(), dice)
    const network = new FakeRoomNetwork(MASTER_ACTOR)
    const transport = network.createTransport(MASTER_ACTOR)
    const remoteTransport = network.createTransport(REMOTE_ACTOR)
    const actorColors = new Map<number, PieceColor>([[REMOTE_ACTOR, 'Red']])

    // eslint-disable-next-line prefer-const
    let bots: BotController
    // Mirrors OnlineLobbyScreen.tsx's own startGame() wiring exactly: the bridge is constructed
    // first (BotController needs it to already exist), so this closes over `bots` rather than
    // reading it eagerly - only ever actually invoked later, from a network message.
    const host = new HostTurnManagerBridge(inner, dice, players, transport, actorColors, null, (color) => bots.releaseColor(color))
    bots = new BotController(host, new Set<PieceColor>(), 10, 2, 2, 0, 0)

    const rolls: unknown[] = []
    host.diceRolled.on((roll) => rolls.push(roll))

    host.start()
    bots.takeOverColor('Red') // simulates OnlineLobbyScreen's onActorLeft handler after a disconnect
    // The bot's own roll is now scheduled ~10ms out - the real player reconnects and rolls for
    // themselves *before* that fires.
    remoteTransport.sendToMaster({ type: 'rollIntent' })
    expect(rolls).toHaveLength(1) // the human's own roll went through immediately (no thinkDelay)

    vi.advanceTimersByTime(50) // well past the bot's own now-stale scheduled roll
    expect(rolls).toHaveLength(1) // still just the one roll - the stale bot action correctly no-opped
  })
})
