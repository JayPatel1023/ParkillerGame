import { describe, expect, it } from 'vitest'
import { isSafeToApplyUpdate } from '../src/hooks/appUpdateSafety'

// See appUpdateSafety.ts's own doc comment - this is the one decision App.tsx's own deferred
// service-worker-update reload makes: never apply a detected update while it would silently drop
// the player out of an active local game or an online session, however long that takes to become
// safe again.
describe('isSafeToApplyUpdate', () => {
  it('is unsafe while a local game is actually in progress', () => {
    expect(isSafeToApplyUpdate('game', '')).toBe(false)
  })

  it('is safe on every local setup screen - nothing but an in-progress choice is lost', () => {
    expect(isSafeToApplyUpdate('start', '')).toBe(true)
    expect(isSafeToApplyUpdate('selectCount', '')).toBe(true)
    expect(isSafeToApplyUpdate('selectColor', '')).toBe(true)
  })

  it('is unsafe for any online hash, even while screen is still "start" underneath it', () => {
    expect(isSafeToApplyUpdate('start', '#online')).toBe(false)
  })

  it('is safe once back on a local screen with no online hash', () => {
    expect(isSafeToApplyUpdate('start', '')).toBe(true)
  })
})
