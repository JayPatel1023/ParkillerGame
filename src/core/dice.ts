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

export class Dice {
  private readonly random: () => number

  constructor(seed?: number) {
    this.random = seed === undefined ? Math.random : mulberry32(seed)
  }

  roll(): number {
    return Math.floor(this.random() * 6) + 1
  }
}
