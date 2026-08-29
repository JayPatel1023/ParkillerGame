// Requested directly ("habría que ponerle alguna música a la introducción del juego" - the game's
// introduction should get some music): intro.mp3, from the client's own original GameMaker
// prototype (Parkiller_GameMaker-main/sounds/sound_musica.mp3 - one of three background tracks
// that prototype's own obj_gameController randomly picks from and loops from the very start of the
// app; this port keeps just the one, smallest track rather than shipping all three - see
// vite.config.ts's own comment on why it's excluded from the service worker's precache). Manages a
// single shared Audio element (not a fresh one per call, unlike hopSound.ts/celebrationSound.ts's
// one-shot cues) since this loops continuously in the background rather than firing once - a
// second instance would just play the same track twice, overlapping itself.
const INTRO_MUSIC_URL = '/music/intro.mp3'
const INTRO_MUSIC_VOLUME = 0.35
const MUTED_STORAGE_KEY = 'parkiller-music-muted'

let audio: HTMLAudioElement | null = null

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(INTRO_MUSIC_URL)
    audio.loop = true
    audio.volume = INTRO_MUSIC_VOLUME
  }
  return audio
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
