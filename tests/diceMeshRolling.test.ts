import { describe, expect, it } from 'vitest'
import { rollingRotationDelta } from '../src/scene/DiceMesh'

// Found via frame-by-frame review of a real local-play recording (b1_0250.jpg, mid-spin): all
// three physical dice - both white ones and the black Parkiller die - showed byte-for-byte
// identical pip orientation at the same instant. Root cause was BoardScene.tsx passing the same
// shared `rolling` boolean to all three <DiceMesh> instances, whose `rolling` branch then
// advanced rotation by one fixed rate with no per-die variation - so three meshes given the same
// per-frame `delta` always landed on the exact same rotation, spinning in perfect mechanical
// unison instead of tumbling independently. This locks in that each die's rotation delta now
// depends on its own `phaseOffset` (already computed per-die from table position, and already
// used by the `nudge` branch for the same "don't move as one rigid block" reason) so a future
// change can't silently re-collapse all three dice back onto the same rotation every frame.
describe('DiceMesh rollingRotationDelta - dice must not spin in lockstep', () => {
  it('gives the three real dice positions distinct rotation deltas for the same frame delta', () => {
    // The exact three (column, row) pairs BoardScene.tsx passes: two white dice side by side,
    // the black Parkiller die on its own row behind them.
    const phaseOffsets = [-0.5, 0.5, 2].map((columnPlusRowTerm) => columnPlusRowTerm * 0.4)
    const delta = 1 / 60

    const deltas = phaseOffsets.map((phaseOffset) => rollingRotationDelta(delta, phaseOffset))

    const xValues = deltas.map((d) => d.x)
    const yValues = deltas.map((d) => d.y)

    // Not all three x deltas equal, and not all three y deltas equal - i.e. the three dice can no
    // longer be forced into identical rotation on every frame of a roll.
    expect(new Set(xValues).size).toBeGreaterThan(1)
    expect(new Set(yValues).size).toBeGreaterThan(1)
  })

  it('still advances rotation forward (never freezes or reverses a die mid-spin)', () => {
    const delta = 1 / 60
    for (const phaseOffset of [-0.5, 0, 0.2, 0.8, 2]) {
      const { x, y } = rollingRotationDelta(delta, phaseOffset)
      expect(x).toBeGreaterThan(0)
      expect(y).toBeGreaterThan(0)
    }
  })

  it('is deterministic - the same delta and phaseOffset always produce the same rotation step', () => {
    expect(rollingRotationDelta(0.016, 0.2)).toEqual(rollingRotationDelta(0.016, 0.2))
  })
})
