// Reported directly (Carlos: "deben estar acompañados de algún sonido" - [the hops] should be
// accompanied by some sound; "Basate en la version de la app que te envié" - base it on the app
// version I sent you): sound_ficha_movimiento.mp3, from the client's own original GameMaker
// prototype (Parkiller_GameMaker-main/sounds/), is a ~100ms tick - clearly meant to play once per
// square hopped, not once per whole move, matching this scene's own "count the hops" visual
// design (see PieceMesh.tsx's own HOP_DURATION comment). Copied as-is into public/sounds/hop.mp3 -
// no re-encoding, it's already a tiny, web-ready file.
//
// Requested directly ("말들을 움직일때의 소리도 3가지로 서로다른 옵션을 택할수잇도록해달라" - the
// sound for moving pieces should also have 3 different selectable options): the other two options
// are that same prototype's sound_burbuja_apretada/sound_burbuja_soltada (a UI "press"/"release"
// blip pair, ~150ms each) - not originally a movement sound, but the right length/character for a
// per-hop tick and, being a genuinely distinct pair rather than a single reused clip twice, gives
// each option here real variety.
const HOP_SOUNDS: { url: string; label: string }[] = [
  { url: '/sounds/hop.mp3', label: 'Sonido 1' },
  { url: '/sounds/hop-2.mp3', label: 'Sonido 2' },
  { url: '/sounds/hop-3.mp3', label: 'Sonido 3' },
]
const HOP_SOUND_VOLUME = 0.55
const HOP_SOUND_STORAGE_KEY = 'parkiller-hop-sound'

export const HOP_SOUND_COUNT = HOP_SOUNDS.length

function clampHopSoundIndex(index: number): number {
  return ((index % HOP_SOUNDS.length) + HOP_SOUNDS.length) % HOP_SOUNDS.length
}

// Persisted the same way introMusic.ts's own track/mute preferences are - picking a tick sound
// once shouldn't need repeating on every reload.
export function getSelectedHopSoundIndex(): number {
  try {
    const stored = Number(window.localStorage.getItem(HOP_SOUND_STORAGE_KEY))
    return Number.isInteger(stored) ? clampHopSoundIndex(stored) : 0
  } catch {
    return 0
  }
}

function setSelectedHopSoundIndex(index: number): void {
  try {
    window.localStorage.setItem(HOP_SOUND_STORAGE_KEY, String(index))
  } catch {
    // Storage can throw (private browsing, quota) - a failed persist just means the preference
    // doesn't survive a reload, not that this toggle should stop working for the current session.
  }
}

export function getHopSoundLabel(index: number): string {
  return HOP_SOUNDS[clampHopSoundIndex(index)].label
}

// Used by GameBoardScreen's own settings panel "next sound" row. Returns the new index so the
// caller can immediately play a preview of it (see playHopSound below) - otherwise the choice
// wouldn't actually be heard until the next real piece move.
export function nextHopSound(): number {
  const next = clampHopSoundIndex(getSelectedHopSoundIndex() + 1)
  setSelectedHopSoundIndex(next)
  return next
}

// A fresh Audio() instance per call, not one shared/reused element - several quick hops in a row
// (a multi-square move) each need their own playback instead of restarting/cutting off whichever
// one was already playing. The files are a few KB each; the browser's own HTTP cache makes every
// call after the first effectively free, so pooling isn't worth the extra complexity here.
export function playHopSound(): void {
  const audio = new Audio(HOP_SOUNDS[getSelectedHopSoundIndex()].url)
  audio.volume = HOP_SOUND_VOLUME
  // Autoplay can be blocked before the page's first user gesture - by the time any piece is
  // actually hopping, the player has already clicked at least once to get this far (pick a
  // player count, a color, "tirar dados"...), so this catch is a defensive no-op, not an expected
  // failure path. A blocked sound should never be allowed to break the move itself.
  audio.play().catch(() => {})
}
