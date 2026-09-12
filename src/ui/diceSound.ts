// Requested directly ("주사위를 던질때도 소리가나게 소리를 넣어달라" - add a sound for when the dice
// are thrown too): sound_dados_girando.mp3, from the client's own original GameMaker prototype
// (Parkiller_GameMaker-main/sounds/) - confirmed against that prototype's own source
// (obj_dado/Other_10.gml: `audio_play_sound(sound_dados_girando, 0, 0)`, fired on every roll) as
// the actual roll sound, not sound_cambia_dado (a different, UI-only "change die" click used
// elsewhere in that same source). Copied as-is into public/sounds/ - same "no re-encoding, already
// web-ready" precedent hopSound.ts/celebrationSound.ts already established for their own clips.
const DICE_ROLL_SOUND_URL = '/sounds/dice-roll.mp3'
const DICE_ROLL_VOLUME = 0.6

// A fresh Audio() instance per call, same reasoning as hopSound.ts/celebrationSound.ts's own
// players - a bonus-turn reroll landing while this clip is still finishing should still get its
// own full playback, not cut off or skipped.
export function playDiceRollSound(): void {
  const audio = new Audio(DICE_ROLL_SOUND_URL)
  audio.volume = DICE_ROLL_VOLUME
  // Same defensive no-op as every other sound here - a blocked/failed sound must never break the
  // roll itself.
  audio.play().catch(() => {})
}
