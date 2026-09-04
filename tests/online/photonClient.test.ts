import { describe, expect, it } from 'vitest'
import { PhotonConnection } from '../../src/online/photonClient'

// Reported directly, with screenshots: one player's own screen was still mid-game while the
// *other* player's client displayed "X salió de la sala - la partida se detuvo" for a color that
// never actually left anything. Confirmed in the Photon Realtime SDK source
// (photon-realtime-module.js): _cleanupGamePeerData(), which runs on *any* local drop of a
// client's own connection to the game server (a WiFi blip, a backgrounded tab, anything transient),
// fires onActorLeave(actor, cleanup=true) for *every* cached actor - not just ones that genuinely
// left. Only cleanup=false is a real, individually server-reported departure of that one actor.
// Drives PhotonConnection's own client.onActorLeave field directly, exactly the shape the real SDK
// itself invokes it with (see src/online/photon-realtime.d.ts's own onActorLeave signature) -
// PhotonConnection's constructor never opens a real network connection on its own.
describe('PhotonConnection.onActorLeft', () => {
  const fakeActor = { actorNr: 7, isLocal: false, name: '', customProperties: {} }

  it('ignores a bulk local-cleanup sweep (cleanup=true) - not a real departure', () => {
    const connection = new PhotonConnection('fake-app-id')
    const seen: number[] = []
    connection.onActorLeft((actorNr) => seen.push(actorNr))

    ;(connection as unknown as { client: { onActorLeave: (actor: typeof fakeActor, cleanup: boolean) => void } }).client.onActorLeave(fakeActor, true)

    expect(seen).toEqual([])
  })

  it('still reports a genuine, individually server-reported departure (cleanup=false)', () => {
    const connection = new PhotonConnection('fake-app-id')
    const seen: number[] = []
    connection.onActorLeft((actorNr) => seen.push(actorNr))

    ;(connection as unknown as { client: { onActorLeave: (actor: typeof fakeActor, cleanup: boolean) => void } }).client.onActorLeave(fakeActor, false)

    expect(seen).toEqual([7])
  })
})
