import { describe, expect, it } from 'vitest'
import { screenStackOffset } from '../src/scene/stackLayout'

const radii = { pawn: 0.55, parkiller: 0.77 }
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])
const at = (group: string[], id: string) => screenStackOffset(group, id, radii)!

// Reported directly ("hay que corregir el problema de visión cuando en una misma casilla están un
// parki y un peón. No se diferencian bien"): the pawn used to land wherever the tile's own local
// axes put it - often directly behind the far bigger Parkiller, which swallowed it. These pin the
// screen-space rules the layout is built on: the pawn in FRONT of the Parki (larger z = nearer the
// default camera), and every pair far enough apart that neither can hide the other.
describe('screenStackOffset', () => {
  it('puts a pawn in front of (never behind) a Parkiller sharing its square, clearly apart from it', () => {
    const group = ['pawn-Green-0', 'parkiller-Purple']
    const pawn = at(group, 'pawn-Green-0')
    const parki = at(group, 'parkiller-Purple')
    expect(pawn[1]).toBeGreaterThan(parki[1])
    expect(dist(pawn, parki)).toBeGreaterThanOrEqual(radii.pawn + 0.6 * radii.parkiller)
  })

  it('does not depend on the order the two were added to the square', () => {
    const a = at(['pawn-Green-0', 'parkiller-Purple'], 'pawn-Green-0')
    const b = at(['parkiller-Purple', 'pawn-Green-0'], 'pawn-Green-0')
    expect(b).toEqual(a)
  })

  it('stands two pawns side by side on the screen\'s horizontal axis, close to touching but never overlapping much', () => {
    const group = ['pawn-Red-0', 'pawn-Red-1']
    const a = at(group, 'pawn-Red-0')
    const b = at(group, 'pawn-Red-1')
    expect(a[1]).toBe(b[1])
    expect(a[0]).toBeLessThan(b[0])
    expect(dist(a, b)).toBeGreaterThanOrEqual(1.8 * radii.pawn)
  })

  it('keeps both pawns in front of the Parkiller when a barrier shares a safe square with one', () => {
    const group = ['pawn-Red-0', 'pawn-Red-1', 'parkiller-Blue']
    const p0 = at(group, 'pawn-Red-0')
    const p1 = at(group, 'pawn-Red-1')
    const parki = at(group, 'parkiller-Blue')
    expect(p0[1]).toBeGreaterThan(parki[1])
    expect(p1[1]).toBeGreaterThan(parki[1])
    expect(dist(p0, p1)).toBeGreaterThanOrEqual(1.8 * radii.pawn)
    expect(dist(p0, parki)).toBeGreaterThanOrEqual(radii.pawn + 0.6 * radii.parkiller)
    expect(dist(p1, parki)).toBeGreaterThanOrEqual(radii.pawn + 0.6 * radii.parkiller)
  })

  it('separates two Parkillers on the same square side by side', () => {
    const group = ['parkiller-Red', 'parkiller-Blue']
    expect(dist(at(group, 'parkiller-Red'), at(group, 'parkiller-Blue'))).toBeGreaterThanOrEqual(1.8 * radii.parkiller)
  })

  it('keeps a pawn in front of two Parkillers', () => {
    const group = ['pawn-Red-0', 'parkiller-Blue', 'parkiller-Gold']
    const pawn = at(group, 'pawn-Red-0')
    expect(pawn[1]).toBeGreaterThan(at(group, 'parkiller-Blue')[1])
    expect(pawn[1]).toBeGreaterThan(at(group, 'parkiller-Gold')[1])
  })

  it('leaves compositions it does not cover to the tile-local fallback', () => {
    expect(screenStackOffset(['pawn-Red-0', 'pawn-Red-1', 'pawn-Red-2'], 'pawn-Red-0', radii)).toBeNull()
    expect(screenStackOffset(['pawn-Red-0', 'pawn-Red-1'], 'pawn-Blue-0', radii)).toBeNull()
  })
})
