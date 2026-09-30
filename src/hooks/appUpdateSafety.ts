export type Screen = 'start' | 'selectCount' | 'selectColor' | 'game'

// Pulled out of App.tsx itself so this is directly unit-testable without dragging in App.tsx's own
// `virtual:pwa-register/react` import - a real Vite virtual module vitest has no plugin to resolve
// at all (this project's vitest.config.ts registers no plugins), so anything importing App.tsx
// directly would fail to load in a test. See App.tsx's own pendingReloadRef doc comment for why
// this decision exists: local play only actually counts as "active" once screen reaches 'game'
// (not the setup screens still ahead of it, where reloading back to 'start' loses nothing but an
// in-progress choice), and *any* online hash counts as unsafe outright - not just an in-progress
// online match specifically, since OnlineLobbyScreen owns everything from the lobby onward and
// this has no visibility into which part of that it's currently in, and a lobby's own Photon
// connection is still real, shared state a silent reload would drop.
export function isSafeToApplyUpdate(screen: Screen, hash: string): boolean {
  return screen !== 'game' && hash !== '#online'
}
