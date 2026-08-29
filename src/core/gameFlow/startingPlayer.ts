import type { DiceLike } from '../dice'
import type { PieceColor } from '../pieceColor'
import type { PlayerState } from './playerState'

export interface StartingPlayerRoll {
  color: PieceColor
  roll: number
}

export interface StartingPlayerResult {
  /** One entry per round of rolls - the first round covers every player, a further round (only
   * reached when the highest roll ties) covers just the tied subset, re-rolling until a unique
   * winner emerges. Kept in full (not just the final round) so the UI can show the whole story on
   * a tie, not just the deciding roll. */
  rounds: StartingPlayerRoll[][]
  /** Index into the original `players` array (not into any one round's own, smaller subset). */
  winnerIndex: number
}

// Requested directly ("para empezar la partida cada jugador (y los bots) lanzan los dados blancos
// para indicar quien comienza la partida" - to start the game, every player, bot-controlled or
// not, rolls the white dice to decide who goes first): TurnManager previously always started with
// players[0], with no roll-off at all - whoever happened to be listed first in the participating-
// colors array always went first, every single game. This rolls both white dice (the same ones
// used in play, not the Parkiller's own black die - "los dados blancos" names them specifically)
// once per player, highest sum wins; a tie re-rolls only the tied players until a unique winner
// emerges, the standard convention and the only way to guarantee termination without an arbitrary
// tie-break the client never specified.
export function determineStartingPlayer(players: readonly PlayerState[], dice: DiceLike): StartingPlayerResult {
  const rounds: StartingPlayerRoll[][] = []
  let candidateIndices = players.map((_, index) => index)

  for (;;) {
    const round: StartingPlayerRoll[] = candidateIndices.map((index) => ({
      color: players[index].color,
      roll: dice.roll() + dice.roll(),
    }))
    rounds.push(round)

    const highestRoll = Math.max(...round.map((r) => r.roll))
    const tiedPositions = round.reduce<number[]>((positions, r, position) => {
      if (r.roll === highestRoll) positions.push(position)
      return positions
    }, [])

    if (tiedPositions.length === 1) {
      return { rounds, winnerIndex: candidateIndices[tiedPositions[0]] }
    }
    candidateIndices = tiedPositions.map((position) => candidateIndices[position])
  }
}
