// Requested directly ("habría que ponerle alguna música a la introducción del juego" - the game's
// introduction should get some music): intro.mp3, from the client's own original GameMaker
// prototype (Parkiller_GameMaker-main/sounds/sound_musica.mp3 - one of three background tracks
// that prototype's own obj_gameController randomly picks from and loops from the very start of the
// app; this port originally kept just the one, smallest track rather than shipping all three - see
// vite.config.ts's own comment on why the whole music/ folder is excluded from the service
// worker's precache regardless of size, so adding two more here doesn't need a change there).
//
// Requested directly again ("Tiene que haber varias melodías de fondo para elegir...y la
// posibilidad de cortar el sonido también" - there should be several background melodies to
// choose from, and the ability to cut the sound too): the mute half already existed; the other
// two tracks (sound_musica_1/_2) are back for the melody half, this time with an actual picker
// (nextMusicTrack, wired to a Settings row) instead of the original's silent per-launch random
// pick - "para elegir" (to choose) was explicit, not just variety for its own sake.
const TRACKS: { url: string; label: string }[] = [
  { url: '/music/intro.mp3', label: 'Melodía 1' },
  { url: '/music/music-2.mp3', label: 'Melodía 2' },
  { url: '/music/music-3.mp3', label: 'Melodía 3' },
]
const INTRO_MUSIC_VOLUME = 0.35
const MUTED_STORAGE_KEY = 'parkiller-music-muted'
const TRACK_STORAGE_KEY = 'parkiller-music-track'

export const TRACK_COUNT = TRACKS.length

let audio: HTMLAudioElement | null = null

function clampTrackIndex(index: number): number {
  return ((index % TRACKS.length) + TRACKS.length) % TRACKS.length
}

// Mirrors the client's own original prototype's playerprefs_get("musica_activa", 1) - a muted
// choice should survive a reload, same as it did there.
export function isMusicMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function setMusicMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTED_STORAGE_KEY, muted ? '1' : '0')
  } catch {
    // Storage can throw (private browsing, quota) - a failed persist just means the preference
    // doesn't survive a reload, not that this toggle should stop working for the current session.
  }
}

// Persisted the same way as the mute preference above, for the same reason - picking a melody
// once shouldn't need repeating on every reload.
export function getSelectedTrackIndex(): number {
  try {
    const stored = Number(window.localStorage.getItem(TRACK_STORAGE_KEY))
    return Number.isInteger(stored) ? clampTrackIndex(stored) : 0
  } catch {
    return 0
  }
}

function setSelectedTrackIndex(index: number): void {
  try {
    window.localStorage.setItem(TRACK_STORAGE_KEY, String(index))
  } catch {
    // Same tradeoff as setMusicMuted above.
  }
}

export function getTrackLabel(index: number): string {
  return TRACKS[clampTrackIndex(index)].label
}

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(TRACKS[getSelectedTrackIndex()].url)
    audio.loop = true
    audio.volume = INTRO_MUSIC_VOLUME
  }
  return audio
}

// Safe to call repeatedly (App.tsx's own screen-driven effect calls this on every render where
// music should be playing) - HTMLMediaElement.play() on an already-playing element is a harmless
// no-op, not a restart.
export function playIntroMusic(): void {
  if (isMusicMuted()) return
  getAudio()
    .play()
    .catch(() => {}) // blocked by autoplay policy before the first user gesture - same defensive no-op hopSound.ts/celebrationSound.ts already use
}

export function pauseIntroMusic(): void {
  audio?.pause()
}

// Used by StartScreen's own settings panel toggle - pauses/resumes the actual element immediately
// (not just the stored preference) so the effect is audible right away, not only after the next
// screen-driven playIntroMusic() call.
export function toggleMusicMuted(): boolean {
  const nowMuted = !isMusicMuted()
  setMusicMuted(nowMuted)
  if (nowMuted) pauseIntroMusic()
  else playIntroMusic()
  return nowMuted
}

// Used by StartScreen's own settings panel "next melody" row. Drops the cached element entirely
// (rather than just swapping its .src) so getAudio() rebuilds fresh against the newly-selected
// track's own URL - simplest way to guarantee loop/volume are set consistently and playback
// restarts from the new track's own beginning, not mid-way through wherever the previous track's
// playhead happened to be. Muted stays muted (playIntroMusic's own check), so switching melodies
// while silenced only ever changes which track plays *next* time music is unmuted.
export function nextMusicTrack(): number {
  const next = clampTrackIndex(getSelectedTrackIndex() + 1)
  setSelectedTrackIndex(next)
  audio?.pause()
  audio = null
  playIntroMusic()
  return next
}
