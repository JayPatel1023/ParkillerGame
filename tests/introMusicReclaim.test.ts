import { describe, expect, it } from 'vitest'
import { shouldReclaimPlayback } from '../src/ui/introMusic'

// Reported directly, via a full audit: switching back to this tab (visibilitychange/focus) used
// to call playIntroMusic() completely unconditionally, with no idea whether the current route
// (online play, or any dev-only tool) is one App.tsx has explicitly paused music for - see
// setRouteAllowsMusic's own doc comment in introMusic.ts. This pins the gating itself.
describe('shouldReclaimPlayback', () => {
  it('reclaims when the tab is visible and the current route allows music', () => {
    expect(shouldReclaimPlayback('visible', true)).toBe(true)
  })

  it('does not reclaim on a route that does not allow music (online play, a dev-only tool)', () => {
    expect(shouldReclaimPlayback('visible', false)).toBe(false)
  })

  it('does not reclaim while the tab is not actually visible', () => {
    expect(shouldReclaimPlayback('hidden', true)).toBe(false)
  })

  it('does not reclaim when neither condition holds', () => {
    expect(shouldReclaimPlayback('hidden', false)).toBe(false)
  })
})
