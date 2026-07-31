// Simple mulberry32 PRNG so rolls can be seeded deterministically for tests/replays.
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// What TurnManager actually depends on - lets tests inject an exact roll sequence instead of a
// seed (a seed is deterministic but its resulting face values aren't hand-pickable).
export interface DiceLike {
  roll(): number
}

export class Dice implements DiceLike {
  private readonly random: () => number

  constructor(seed?: number) {
    this.random = seed === undefined ? Math.random : mulberry32(seed)
  }

  roll(): number {
    return Math.floor(this.random() * 6) + 1
  }
}
