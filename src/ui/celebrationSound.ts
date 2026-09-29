// Requested directly ("cuando se elimina a un peón o un peón llega a la meta debe haber alguna
// celebración con música" - when a pawn is eliminated or a pawn reaches the goal, there should be
// some musical celebration): capture.mp3/finish.mp3/game-won.mp3, from the client's own original
// GameMaker prototype (Parkiller_GameMaker-main/sounds/ - sound_ficha_comida, sound_ficha_finaliza,
// sound_partida_finalizada respectively, confirmed against that prototype's own source: the first
// plays on every capture, obj_ficha_player/Create_0.gml:469; the second when a piece finishes,
// same file:302; the third alongside the win banner, obj_cartel_ganaste/Create_0.gml:14-15).
// Copied as-is into public/sounds/ - same "no re-encoding, already tiny and web-ready" precedent
// this scene layer's own hopSound.ts already established for hop.mp3.
const CAPTURE_SOUND_URL = '/sounds/capture.mp3'
const FINISH_SOUND_URL = '/sounds/finish.mp3'
const GAME_WON_SOUND_URL = '/sounds/game-won.mp3'
const CELEBRATION_VOLUME = 0.6

// A fresh Audio() instance per call, same reasoning as hopSound.ts's own playHopSound - these are
// one-shot cues that never need to interrupt or be interrupted by an unrelated one still playing
// (a capture chaining a reward, or two quick finishes back to back, should each be heard in full).
function play(url: string): void {
  const audio = new Audio(url)
  audio.volume = CELEBRATION_VOLUME
  // Same defensive no-op as hopSound.ts - a blocked/failed sound must never break the game itself.
  audio.play().catch(() => {})
}

export function playCaptureSound(): void {
  play(CAPTURE_SOUND_URL)
}

// Requested directly ("말들이 서로 상대방말을 잡아먹었을때에는 알림만뜨는게 아니라... 재미난 음악효과와
// 장식효과를 주어야한다" - when pieces eat each other it shouldn't be just a notification, there
// should be a cool, fun MUSIC effect and decoration too): capture.mp3 (ported as-is from the
// original prototype's own sound_ficha_comida - see this file's own opening comment) is a bare
// 0.57s bite hit with no musical character at all - there was no other, more festive asset sitting
// unused in that same prototype to reach for instead (checked its own sounds/ folder directly).
// Synthesizes a short three-note ascending chime with the Web Audio API - no new audio asset needed
// - and layers it under the same bite hit, so a capture keeps its "impact" (the bite) but gains an
// actual musical flourish on top of it (the chime).
function playCaptureChime(): void {
  try {
    const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return
    const ctx = new AudioContextCtor()
    // Reported directly, repeatedly, across many separate sessions ("전에 내가 여러번
    // 음악효과를 넣으라고말했고... 실지로 반영되지않았다" - I told you several times to add sound
    // effects, but it was never actually reflected): the plain play(url) sample this function's
    // own caller (playCaptureFanfare) also plays has worked the whole time (a bare
    // HTMLAudioElement, far more permissive autoplay-wise almost everywhere) - only ever this
    // file's own synthesized flourishes were missing, which points squarely at the one thing
    // genuinely different about them: a fresh AudioContext isn't guaranteed to start "running"
    // just because the page already has autoplay permission from an earlier gesture - some
    // browsers (older Safari/WebKit especially) still create it "suspended" until something
    // explicitly resumes it, and a suspended context schedules its oscillators silently, with no
    // error at all - exactly a "the code runs, nothing throws, but nothing is ever actually heard"
    // report. Safe to call unconditionally even where the context was already running (resume() on
    // an already-running context is a harmless no-op) - the same call is repeated in this file's
    // other two chimes below, for the same reason.
    void ctx.resume().catch(() => {})
    const now = ctx.currentTime
    // A bright ascending major triad (E5-G#5-B5) - the classic arcade/combo "ding-ding-ding!" -
    // triangle waves read as a soft bell/xylophone rather than a harsh synth buzz, fitting a
    // children's game more than a sharper square/sawtooth wave would.
    const notes = [659.25, 830.61, 987.77]
    notes.forEach((freq, i) => {
      const start = now + i * 0.08
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.22, start + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.32)
    })
    // Closing the context once the last note has fully decayed - AudioContexts are a limited
    // per-page resource, and nothing else here ever needs this one again after this one chime.
    setTimeout(() => ctx.close(), 600)
  } catch {
    // Web Audio unavailable or blocked (autoplay policy, an old browser) - playCaptureFanfare's own
    // separate play(CAPTURE_SOUND_URL) call still goes through either way, so a capture is never
    // left completely silent over just this flourish failing.
  }
}

// Used for a genuine "you just ate an opponent's piece" moment only - a regular pawn-vs-pawn or
// Parki-vs-Parki capture (PC5), and a Parki eating a pawn outright (PK5). Deliberately NOT used for
// the three-consecutive-doubles penalty (PC2.3, GameBoardScreen.tsx still calls plain
// playCaptureSound() there) - that's a piece going home off a bad roll, not a prize, and a cheerful
// chime on top of it would read as celebrating the wrong thing.
export function playCaptureFanfare(): void {
  play(CAPTURE_SOUND_URL)
  playCaptureChime()
}

// Requested directly, alongside the capture fanfare above ("alert를 띄워주는 형식이 멋이없다... 좀
// 생큼하게" - the current finish moment reads like a plain alert, make it feel fresher/livelier):
// finish.mp3 (ported the same way as capture.mp3/game-won.mp3 - see this file's own opening
// comment) is, like those two were, a bare stinger with no build. Same Web Audio technique as
// playCaptureChime/playWinChime, but its own distinct character: a soft ascending bell arpeggio on
// sine waves (airier than the capture chime's brighter triangle "ding") settling into one held,
// slowly-decaying note - reads as a piece gently arriving and settling home, between the capture
// chime's quick "got it!" and the win chime's much bigger "ta-daa!" build.
function playFinishChime(): void {
  try {
    const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return
    const ctx = new AudioContextCtor()
    // See playCaptureChime's own comment on this same call - a fresh AudioContext can start
    // "suspended" on some browsers even with the page's autoplay permission already granted.
    void ctx.resume().catch(() => {})
    const now = ctx.currentTime
    // C5-E5-G5, the same plain major triad the other two chimes both use, but a step lower and on
    // sine waves - a warmer, softer arpeggio to fit an "arrival" rather than a "hit" or a "fanfare".
    const notes = [523.25, 659.25, 783.99]
    notes.forEach((freq, i) => {
      const start = now + i * 0.12
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.2, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.37)
    })
    // The settling note - held an octave up, fading slowly, so the arpeggio has somewhere to land
    // rather than just stopping the instant its last note decays.
    const settleStart = now + notes.length * 0.12
    const settleOsc = ctx.createOscillator()
    const settleGain = ctx.createGain()
    settleOsc.type = 'sine'
    settleOsc.frequency.value = 1046.5
    settleGain.gain.setValueAtTime(0, settleStart)
    settleGain.gain.linearRampToValueAtTime(0.16, settleStart + 0.05)
    settleGain.gain.exponentialRampToValueAtTime(0.0001, settleStart + 0.7)
    settleOsc.connect(settleGain).connect(ctx.destination)
    settleOsc.start(settleStart)
    settleOsc.stop(settleStart + 0.75)
    setTimeout(() => ctx.close(), 1200)
  } catch {
    // Same reasoning as playCaptureChime/playWinChime's own catch - Web Audio unavailable/blocked
    // must never stop the plain play(FINISH_SOUND_URL) call below from still landing on its own.
  }
}

export function playFinishSound(): void {
  play(FINISH_SOUND_URL)
  playFinishChime()
}

// Requested again alongside the capture fanfare above ("우승했을때... 멋진 3D효과와 음악효과" - a
// cooler 3D effect and sound effect for winning too): game-won.mp3, ported the same way as
// capture.mp3/finish.mp3 from the original prototype (sound_partida_finalizada), is a single bare
// stinger with no build to it - winning the whole game is the biggest moment in a match and it was
// getting the same one-shot treatment as every smaller pickup. Same technique as playCaptureChime
// above (Web Audio, no new asset needed), but bigger: a four-note ascending run across two octaves
// leading into a sustained three-oscillator chord swell, so it reads as a "ta-daa!" build-and-land
// rather than the chime's quick "ding-ding-ding".
function playWinChime(): void {
  try {
    const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return
    const ctx = new AudioContextCtor()
    // See playCaptureChime's own comment on this same call - a fresh AudioContext can start
    // "suspended" on some browsers even with the page's autoplay permission already granted.
    void ctx.resume().catch(() => {})
    const now = ctx.currentTime
    // C5-E5-G5-C6: the same bright major-triad character as the capture chime, extended up to the
    // octave so the run itself feels like it's climbing somewhere, not just repeating the chord.
    const runNotes = [523.25, 659.25, 783.99, 1046.5]
    runNotes.forEach((freq, i) => {
      const start = now + i * 0.1
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.24, start + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.3)
    })
    // The landing chord - C6+E6+G6 together, not in sequence - swelling in just as the run's last
    // note fades, then held and faded out slowly so the win moment has something to sit in rather
    // than ending the instant the last note of the run stops.
    const chordStart = now + runNotes.length * 0.1
    const chordFreqs = [1046.5, 1318.51, 1567.98]
    chordFreqs.forEach((freq) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, chordStart)
      gain.gain.linearRampToValueAtTime(0.18, chordStart + 0.08)
      gain.gain.exponentialRampToValueAtTime(0.0001, chordStart + 1.1)
      osc.connect(gain).connect(ctx.destination)
      osc.start(chordStart)
      osc.stop(chordStart + 1.15)
    })
    setTimeout(() => ctx.close(), 1600)
  } catch {
    // Same reasoning as playCaptureChime's own catch - Web Audio unavailable/blocked must never
    // stop the plain play(GAME_WON_SOUND_URL) call below from still landing on its own.
  }
}

export function playGameWonSound(): void {
  play(GAME_WON_SOUND_URL)
  playWinChime()
}
