import { describe, expect, it } from 'vitest'
import { computeBotStatusLine } from '../src/ui/GameBoardScreen'

// Bug found by close video review of a real local (vs-bots) recording (b2_0369-0385, t=368-386s):
// once it became a bot's (Blue's) turn, GameBoardScreen's turn-status subtitle froze on
// "Esperando el turno de Blue..." for that bot's *entire* turn - it never updated even while the
// roll button visibly flipped RODANDO.../TIRAR DADOS (a real roll happening) and a blue pawn was
// visibly animating out of its yard along the track. Root cause: the old statusLine's plain
// `!isMyTurn` branch was built for ONLINE's untrusted-other-client case (where there's genuinely
// nothing else honest to report), but a later commit reused the exact same isMyTurn plumbing for
// local vs-bots play, which silently swept a bot's whole turn under that same online-only
// placeholder even though rolling/lastRoll/pendingMoves/pendingReward are all populated for a
// bot's turn exactly like a human's. computeBotStatusLine (GameBoardScreen.tsx) is the fix: reads
// those raw values (only for local play) and narrates the bot's actual progress in third person,
// still falling back to the plain placeholder for online and for a bot's turn before its first
// roll lands.
describe('computeBotStatusLine - GameBoardScreen turn-status subtitle during a bot\'s turn', () => {
  const base = {
    isLocalGame: true,
    rolling: false,
    animationsSettled: true,
    pendingReward: null,
    pendingMoves: [] as unknown[],
    visibleRoll: null as { dieA: number; dieB: number; blackDie: number } | null,
    isDouble: false,
    currentPlayerColor: 'Blue',
  }

  it('shows the plain placeholder for a local bot turn before its first roll has landed', () => {
    expect(computeBotStatusLine(base)).toBe('Esperando el turno de Blue...')
  })

  it('reflects a real roll actually in progress, instead of staying on the placeholder', () => {
    // Mirrors the exact recorded sequence: the button flips to RODANDO... (rolling=true) while the
    // subtitle used to stay frozen on "Esperando el turno de Blue...".
    expect(computeBotStatusLine({ ...base, rolling: true })).toBe('Blue está tirando los dados...')
  })

  it('reflects the bot actively choosing a piece to move once its roll has settled', () => {
    expect(computeBotStatusLine({ ...base, pendingMoves: [{ piece: 'p1', amount: 3 }] })).toBe(
      'Blue está eligiendo una ficha...',
    )
  })

  it('reflects the bot choosing a reward piece', () => {
    expect(computeBotStatusLine({ ...base, pendingReward: { reason: 'capture' } })).toBe(
      'Blue está eligiendo una ficha para su recompensa...',
    )
  })

  it('shows the settled roll (with the actual dice values) while the bot is mid-turn with nothing else pending', () => {
    expect(
      computeBotStatusLine({ ...base, visibleRoll: { dieA: 6, dieB: 6, blackDie: 1 }, isDouble: true }),
    ).toBe('Dados: 6 y 6 (dobles) · Parkiller: 1 · Blue está jugando...')
  })

  it('does not surface pendingMoves/pendingReward text while a capture/move animation is still settling', () => {
    expect(
      computeBotStatusLine({
        ...base,
        animationsSettled: false,
        pendingMoves: [{ piece: 'p1', amount: 3 }],
        pendingReward: { reason: 'capture' },
      }),
    ).toBe('Esperando el turno de Blue...')
  })

  it('falls back to the plain "Esperando el turno de X..." placeholder for a genuine online other-client turn, regardless of any in-flight roll/move data', () => {
    // Confirms the fix does not regress online's original turn-ownership behavior: an online
    // client seeing another player's turn should still get the terse, untrusted-other-client copy,
    // never the bot-narration text (there are no bots online, and it isn't this client's business
    // to narrate another human's turn).
    expect(
      computeBotStatusLine({
        ...base,
        isLocalGame: false,
        rolling: true,
        pendingMoves: [{ piece: 'p1', amount: 3 }],
        pendingReward: { reason: 'capture' },
        visibleRoll: { dieA: 6, dieB: 6, blackDie: 1 },
      }),
    ).toBe('Esperando el turno de Blue...')
  })
})
