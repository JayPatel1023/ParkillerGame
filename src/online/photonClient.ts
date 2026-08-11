import * as Photon from 'photon-realtime'
import type { RoomTransport } from './roomTransport'

// The Photon Realtime docs site (doc.photonengine.com) was unreachable to verify against directly
// (bot-blocked), so every method/property name below was confirmed by reading the actual shipped
// module source (node_modules/photon-realtime/photon-realtime-module.js, v4.4.0) rather than
// assumed from memory - grep for the literal name there before changing any of these calls.
const LBC = Photon.LoadBalancing.LoadBalancingClient
const APP_VERSION = '1.0'
// Event codes 0-199 are available for game-defined events (200+ are reserved by Photon itself) -
// a single code is enough since every message we send carries its own `type` field.
const GAME_EVENT_CODE = 1

export interface ActorInfo {
  actorNr: number
  isLocal: boolean
  customProperties: Record<string, unknown>
}

/**
 * Thin wrapper around the Photon Realtime SDK - implements RoomTransport (what the turn-sync
 * bridges depend on) plus the connection/lobby/room-property surface OnlineLobbyScreen needs for
 * seat assignment. Nothing here has been exercised against a real Photon App ID yet (none was
 * available while building this) - the API calls are correct per the SDK's own source, but a real
 * two-tab connection test is still a required follow-up before shipping.
 */
export class PhotonConnection implements RoomTransport {
  private client: InstanceType<typeof LBC>
  private messageListeners: Array<(data: unknown, senderActorNr: number) => void> = []
  private masterChangeListeners: Array<() => void> = []
  private lastKnownMasterActorNr: number | null = null

  constructor(appId: string) {
    this.client = new LBC(Photon.ConnectionProtocol.Wss, appId, APP_VERSION)
    this.client.onEvent = (code: number, content: unknown, actorNr: number) => {
      if (code !== GAME_EVENT_CODE) return
      for (const listener of this.messageListeners) listener(content, actorNr)
    }
    this.client.onActorJoin = () => this.checkMasterChanged()
    this.client.onActorLeave = () => this.checkMasterChanged()
  }

  /** Resolves once connected and sitting in the lobby (ready to create/join a room). */
  connect(region: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.onStateChange = (state: number) => {
        if (this.client.isInLobby()) resolve()
        else if (state === LBC.State.Error || state === LBC.State.Disconnected) {
          reject(new Error(`Photon connection failed (state ${LBC.StateToName(state)})`))
        }
      }
      this.client.connectToRegionMaster(region)
    })
  }

  /** Room "name" is the join code - Photon's own uniqueness-per-region handles the rest, no
   * separate matchmaking service needed. */
  createRoom(code: string, maxPlayers: number): Promise<void> {
    return this.joinOrCreate(code, { createIfNotExists: true, maxPlayers } as Photon.LoadBalancing.RoomOptions)
  }

  joinRoom(code: string): Promise<void> {
    return this.joinOrCreate(code, undefined)
  }

  private joinOrCreate(code: string, options: Photon.LoadBalancing.RoomOptions | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.onStateChange = (state: number) => {
        if (this.client.isJoinedToRoom()) {
          this.lastKnownMasterActorNr = this.client.myRoomMasterActorNr()
          resolve()
        } else if (state === LBC.State.Error) {
          reject(new Error('Failed to join or create room'))
        }
      }
      this.client.joinRoom(code, options)
    })
  }

  get localActorNr(): number {
    return this.client.myActor().actorNr
  }

  isMasterClient(): boolean {
    return this.client.myActor().actorNr === this.client.myRoomMasterActorNr()
  }

  sendToMaster(data: unknown): void {
    this.client.raiseEvent(GAME_EVENT_CODE, data, { receivers: Photon.LoadBalancing.Constants.ReceiverGroup.MasterClient })
  }

  broadcast(data: unknown): void {
    // ReceiverGroup.All includes the sender itself (confirmed in the SDK's own usage example) -
    // the Master Client's own bridge relies on this to receive its own broadcasts through the
    // exact same code path as everyone else, rather than needing a separate local-echo branch.
    this.client.raiseEvent(GAME_EVENT_CODE, data, { receivers: Photon.LoadBalancing.Constants.ReceiverGroup.All })
  }

  onMessage(listener: (data: unknown, senderActorNr: number) => void): () => void {
    this.messageListeners.push(listener)
    return () => {
      this.messageListeners = this.messageListeners.filter((l) => l !== listener)
    }
  }

  onMasterClientChanged(listener: () => void): () => void {
    this.masterChangeListeners.push(listener)
    return () => {
      this.masterChangeListeners = this.masterChangeListeners.filter((l) => l !== listener)
    }
  }

  private checkMasterChanged(): void {
    const current = this.client.myRoomMasterActorNr()
    if (current !== this.lastKnownMasterActorNr) {
      this.lastKnownMasterActorNr = current
      for (const listener of this.masterChangeListeners) listener()
    }
  }

  // --- Room/actor custom properties - seat assignment for OnlineLobbyScreen, not used by the
  // turn-sync bridges. Photon auto-syncs these to every actor in the room with no extra plumbing. ---

  setRoomProperties(props: Record<string, unknown>): void {
    this.client.myRoom().setCustomProperties(props)
  }

  getRoomProperties(): Record<string, unknown> {
    return this.client.myRoom().getCustomProperties()
  }

  setLocalActorProperties(props: Record<string, unknown>): void {
    this.client.myActor().setCustomProperties(props)
  }

  getActors(): ActorInfo[] {
    return this.client.myRoomActorsArray().map((actor) => ({
      actorNr: actor.actorNr,
      isLocal: actor.isLocal,
      customProperties: actor.getCustomProperties(),
    }))
  }

  onActorsChanged(listener: () => void): () => void {
    const wrappedJoin = () => listener()
    const wrappedLeave = () => listener()
    const prevJoin = this.client.onActorJoin
    const prevLeave = this.client.onActorLeave
    this.client.onActorJoin = (actor) => {
      prevJoin?.(actor)
      wrappedJoin()
    }
    this.client.onActorLeave = (actor, cleanup) => {
      prevLeave?.(actor, cleanup)
      wrappedLeave()
    }
    return () => {
      this.client.onActorJoin = prevJoin
      this.client.onActorLeave = prevLeave
    }
  }

  disconnect(): void {
    this.client.disconnect()
  }
}
