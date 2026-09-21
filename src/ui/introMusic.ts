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
//
// Requested directly again ("오락을 하는기간에도... 음악을 넣어야겠는데" - during the gameplay
// period too, we need music so it's not boring): despite the name, this module's own playback was
// never actually limited to the intro/lobby screens - App.tsx's own screen-driven effect was what
// silenced it the instant a game started. That's the piece that changed (see App.tsx), not
// anything here; the same 3 tracks/picker now carry straight through into gameplay.
// Reported directly, via a client-supplied Network-tab screenshot: music-3.mp3 alone was 7.2MB,
// noticeably heavier than the other two tracks (3.3MB/4.3MB) despite a near-identical 3-minute
// length - it turned out to be encoded at 320kbps (MP3's own maximum) while its siblings sit around
// 185-190kbps, an inconsistency rather than a deliberate quality choice. Re-encoded to 160kbps (well
// above what background game music needs to sound clean, still a bit more conservative than its
// siblings' own bitrate) - 3.6MB, exactly half, with no other change.
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

// Reported directly ("처음시작할때부터하여 오락할때도 항상같은노래가나온다 하지만 지금은 3개가 다섞여서
// 나오는것같애" - normally the same song plays from the start all the way through gameplay, but now
// it sounds like all 3 are mixed together): confirmed directly - this app has been reloaded/reopened
// many times across a single long testing session, exactly the kind of use that leaves several tabs
// of it open at once. The `audio` singleton above only dedupes playback *within* one tab - each tab
// is its own independent JS realm with its own copy of this module, so several tabs each happily
// loop their own selected track at once, audibly layering into "3 different songs" (this app's own
// TRACK_COUNT) the instant more than one has autoplayed.
//
// A BroadcastChannel-based claim protocol fixes this without asking the player to manage tabs
// themselves: whichever tab is actually in the foreground claims playback and broadcasts that claim;
// every other tab hearing a claim that isn't its own immediately pauses its own audio. Re-claimed on
// every focus/visibility change, so switching between tabs hands playback off automatically instead
// of requiring a reload - the tab you're actually looking at is always the one making sound.
const TAB_ID = Math.random().toString(36).slice(2)
let claimChannel: BroadcastChannel | null = null

function getClaimChannel(): BroadcastChannel | null {
  // Not universally available (older Safari, some embedded webviews) - playback still works fine
  // within a single tab without it, just without the cross-tab handoff.
  if (typeof BroadcastChannel === 'undefined') return null
  if (!claimChannel) {
    claimChannel = new BroadcastChannel('parkiller-music-claim')
    claimChannel.onmessage = (event: MessageEvent<{ tabId: string }>) => {
      if (event.data?.tabId !== TAB_ID) audio?.pause()
    }
  }
  return claimChannel
}

function claimPlayback(): void {
  getClaimChannel()?.postMessage({ tabId: TAB_ID })
}

// Re-claims the moment this tab becomes the one the player is actually looking at - covers both
// switching browser tabs (visibilitychange) and switching back from another app/window entirely
// (focus, which visibilitychange alone doesn't always catch consistently across browsers).
if (typeof window !== 'undefined') {
  const reclaimIfVisible = () => {
    if (document.visibilityState !== 'visible') return
    playIntroMusic()
  }
  document.addEventListener('visibilitychange', reclaimIfVisible)
  window.addEventListener('focus', reclaimIfVisible)
}

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
    // Claimed only once play() genuinely resolves, not right after calling it - claiming
    // unconditionally could silence every *other* tab's audio over a play() that itself then goes on
    // to fail (blocked by the autoplay policy before this tab has ever had a user gesture), leaving
    // nothing playing anywhere instead of just leaving the already-playing tab alone.
    .then(() => claimPlayback())
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
