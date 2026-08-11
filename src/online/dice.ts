import { Dice, type DiceLike } from '../core/dice'

/**
 * Wraps a real Dice on the Master Client so its actual roll values can be captured and broadcast -
 * TurnManager.requestRoll() always calls .roll() exactly 3 times in order (dieA, dieB, blackDie),
 * so draining after each requestRoll() call yields exactly those 3 values in that order.
 */
export class RecordingDice implements DiceLike {
  private readonly inner: DiceLike
  private log: number[] = []

  constructor(inner: DiceLike = new Dice()) {
    this.inner = inner
  }

  roll(): number {
    const value = this.inner.roll()
    this.log.push(value)
    return value
  }

  /** Removes and returns every value rolled since the last drain, in roll order. */
  drain(): number[] {
    const values = this.log
    this.log = []
    return values
  }
}

/**
 * Feeds a non-master client's own local TurnManager the exact values the Master already rolled
 * (received over the network), instead of generating new ones - this is what makes replaying a
 * requestRoll() call on a remote client deterministic and correct.
 */
export class QueueDice implements DiceLike {
  private queue: number[] = []

  push(...values: number[]): void {
    this.queue.push(...values)
  }

  roll(): number {
    const value = this.queue.shift()
    if (value === undefined) {
      throw new Error(
        'QueueDice.roll() called with nothing queued - a diceRolled message must be pushed before replaying requestRoll()',
      )
    }
    return value
  }
}
