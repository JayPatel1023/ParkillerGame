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

export function playFinishSound(): void {
  play(FINISH_SOUND_URL)
}

export function playGameWonSound(): void {
  play(GAME_WON_SOUND_URL)
}
