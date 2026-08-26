// Reported directly (Carlos: "deben estar acompañados de algún sonido" - [the hops] should be
// accompanied by some sound; "Basate en la version de la app que te envié" - base it on the app
// version I sent you): sound_ficha_movimiento.mp3, from the client's own original GameMaker
// prototype (Parkiller_GameMaker-main/sounds/), is a ~100ms tick - clearly meant to play once per
// square hopped, not once per whole move, matching this scene's own "count the hops" visual
// design (see PieceMesh.tsx's own HOP_DURATION comment). Copied as-is into public/sounds/hop.mp3 -
// no re-encoding, it's already a tiny, web-ready file.
const HOP_SOUND_URL = '/sounds/hop.mp3'
const HOP_SOUND_VOLUME = 0.55

// A fresh Audio() instance per call, not one shared/reused element - several quick hops in a row
// (a multi-square move) each need their own playback instead of restarting/cutting off whichever
// one was already playing. The file is 5KB; the browser's own HTTP cache makes every call after
// the first effectively free, so pooling isn't worth the extra complexity here.
export function playHopSound(): void {
  const audio = new Audio(HOP_SOUND_URL)
  audio.volume = HOP_SOUND_VOLUME
  // Autoplay can be blocked before the page's first user gesture - by the time any piece is
  // actually hopping, the player has already clicked at least once to get this far (pick a
  // player count, a color, "tirar dados"...), so this catch is a defensive no-op, not an expected
  // failure path. A blocked sound should never be allowed to break the move itself.
  audio.play().catch(() => {})
}
