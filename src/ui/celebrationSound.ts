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

export function playFinishSound(): void {
  play(FINISH_SOUND_URL)
}

export function playGameWonSound(): void {
  play(GAME_WON_SOUND_URL)
}
