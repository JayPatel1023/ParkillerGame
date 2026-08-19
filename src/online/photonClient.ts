import * as Photon from 'photon-realtime'
import type { RoomTransport } from './roomTransport'

// The Photon Realtime docs site (doc.photonengine.com) was unreachable to verify against directly
// (bot-blocked), so every method/property name below was confirmed by reading the actual shipped
// module source (node_modules/photon-realtime/photon-realtime-module.js, v4.4.0) rather than
// assumed from memory - grep for the literal name there before changing any of these calls.
// Confirmed live (real Photon connection, not the fake test transport): the SDK's own bundled
// module already has correct browser detection buried in it (PhotonPeer.webSocketImpl defaults to
// the native WebSocket when `typeof WebSocket !== 'undefined'`) - but a later line in that exact
// same file unconditionally overwrites it with a Node-only wrapper that does `require("ws")`,
// which throws immediately in a browser ("ws does not work in the browser..."). Restoring the
// native implementation here, after the module has finished loading (and so after its own
// override already ran), undoes that - the browser's WebSocket already satisfies the shape
// PhotonPeer expects (onopen/onmessage/onerror/onclose, send()/close()), no wrapper class needed.
Photon.PhotonPeer.setWebSocketImpl(WebSocket)

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
   * separate matchmaking service needed. maxPlayers has to travel as joinRoom's own THIRD argument
   * (createRoomOptions) - confirmed directly in the SDK source (fillCreateRoomOptions reads
   * maxPlayers off that argument specifically), not the second (joinRoomOptions, which only holds
   * createIfNotExists/rejoin/expectedUsers). Passing it as part of the second argument, as an
   * earlier version of this did, silently drops it - every room ends up with no player cap at all. */
  createRoom(code: string, maxPlayers: number): Promise<void> {
    return this.joinOrCreate(code, { createIfNotExists: true }, { maxPlayers })
  }

  joinRoom(code: string): Promise<void> {
    return this.joinOrCreate(code, undefined, undefined)
  }

  private joinOrCreate(
    code: string,
    joinOptions: Photon.LoadBalancing.RoomOptions | undefined,
    createOptions: Photon.LoadBalancing.RoomOptions | undefined,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      this.client.onStateChange = (state: number) => {
        if (settled) return
        if (this.client.isJoinedToRoom()) {
          settled = true
          this.lastKnownMasterActorNr = this.client.myRoomMasterActorNr()
          resolve()
        } else if (state === LBC.State.Error) {
          settled = true
          reject(new Error('Failed to join or create room'))
        }
      }
      // onStateChange alone misses operation-level failures (wrong room code, room full, room
      // already exists) - confirmed directly in the SDK source: those flow only through
      // _onOperationResponseInternal2 -> onOperationResponse, which never touches state at all.
      // Without this, a mistyped room code just leaves the caller's promise pending forever - the
      // UI stays on its "joining..." spinner with no error, no timeout, no way out.
      this.client.onOperationResponse = (errorCode, errorMsg, operationCode) => {
        if (settled) return
        const { OperationCode, ErrorCode } = Photon.LoadBalancing.Constants
        if (operationCode !== OperationCode.JoinGame && operationCode !== OperationCode.CreateGame) return
        if (errorCode === ErrorCode.Ok) return
        settled = true
        // English here, matching this file's other errors (e.g. "Failed to join or create room"
        // just above) - OnlineLobbyScreen.tsx is where user-facing (Spanish) text lives, same
        // layering as its existing "Falta VITE_PHOTON_APP_ID..." message.
        const reason =
          errorCode === ErrorCode.GameDoesNotExist
            ? 'room does not exist'
            : errorCode === ErrorCode.GameFull
              ? 'room is full'
              : errorCode === ErrorCode.GameClosed
                ? 'room has already started'
                : errorCode === ErrorCode.GameIdAlreadyExists
                  ? 'room code already in use'
                  : errorMsg || `operation error ${errorCode}`
        reject(new Error(reason))
      }
      this.client.joinRoom(code, joinOptions, createOptions)
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

  // Reported directly: real players who join a room *after* the Master already clicked "Empezar
  // partida" (e.g. the Master starting alone/early, or two friends' joins racing the start click)
  // still connect successfully and land in the game - a room stays open forever by default (see
  // photon-realtime.d.ts's own setIsOpen comment), this app's own "started" flag on room properties
  // was never wired up to actually close it. That late joiner's client independently recomputes its
  // own color via colorsByActorNr from whichever actors happen to be in the room *at that moment* -
  // completely disconnected from the actorColors map the Master already froze at start time (see
  // HostTurnManagerBridge) - so it picks a color that's *already* bot-controlled there. The result:
  // a real person whose every roll/move intent the Master silently rejects (isValidActor fails,
  // their actorNr was never in that frozen map), while a bot visibly keeps playing "their" seat -
  // exactly "only the creator can actually play, everyone else can only watch". Closing the room
  // the instant the game starts makes the SDK reject any further join outright (GameClosed, already
  // mapped to a clear error in joinRoom() above) instead of silently admitting a phantom player.
  closeRoom(): void {
    this.client.myRoom().setIsOpen(false)
  }

  getRoomProperties(): Record<string, unknown> {
    return this.client.myRoom().getCustomProperties()
  }

  // Reported directly, with a real two-player test: a joiner ended up controlled by a bot instead
  // of themselves, even after the earlier seat-list-refresh fix. Root cause - a *second*, more
  // serious bug than that one: OnlineLobbyScreen previously derived the joiner's own player count
  // (and therefore which color set to pick from) by reading a *custom* room property
  // (setRoomProperties({ playerCount }), set by the host right after createRoom() resolves). A
  // joiner racing in quickly enough could read that property before it had synced, silently
  // falling back to a default of 4 players and picking a color from the wrong (4-player) color
  // set entirely - one that doesn't even appear in the real (e.g. 2-player) game, so it never
  // matches when the host later checks who's claimed what, and that seat gets bot-filled despite
  // a real second player being connected the whole time. maxPlayers is Photon's own built-in room
  // property (see photon-realtime.d.ts's own comment) instead, set atomically at room-creation
  // time - a joiner reading it can never race the host's own createRoom() the way a custom
  // property set *after* the room exists can.
  getMaxPlayers(): number {
    return this.client.myRoom().maxPlayers
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

  // Reported directly: a joiner's seat kept showing "vacío -> bot" in the host's lobby even after
  // that player had actually connected and claimed a color - confirmed in the SDK source
  // (photon-realtime-module.js) that joining and a later custom-properties update are two
  // *separate* events (onActorJoin vs. the SDK's own onActorPropertiesChange, fired for the
  // room's PropertiesChanged event). setLocalActorProperties() is only called by a joiner *after*
  // their own joinRoom() promise has already resolved (see OnlineLobbyScreen.tsx's joinRoom()) -
  // by the time their color reaches the host, the host's own onActorJoin has already fired and
  // won't fire again. This previously only re-rendered on join/leave, so that later color update
  // never triggered a re-render at all - the lobby's own seat list state went stale and stayed
  // that way. (startGame() itself re-reads getActors() fresh at click time, so the actual color
  // assignment was never wrong once a real game was started - only the lobby's own live display
  // was, but that's exactly what a host waiting on this screen has to trust before starting.)
  onActorsChanged(listener: () => void): () => void {
    const fire = () => listener()
    const prevJoin = this.client.onActorJoin
    const prevLeave = this.client.onActorLeave
    const prevPropsChange = this.client.onActorPropertiesChange
    this.client.onActorJoin = (actor) => {
      prevJoin?.(actor)
      fire()
    }
    this.client.onActorLeave = (actor, cleanup) => {
      prevLeave?.(actor, cleanup)
      fire()
    }
    this.client.onActorPropertiesChange = (actor) => {
      prevPropsChange?.(actor)
      fire()
    }
    return () => {
      this.client.onActorJoin = prevJoin
      this.client.onActorLeave = prevLeave
      this.client.onActorPropertiesChange = prevPropsChange
    }
  }

  // Reported directly: if a real player leaves an in-progress online game, the rest of the room
  // just silently kept playing shorthanded instead of stopping - wanted to know *who* left and have
  // the game end there. Unlike onActorsChanged above (a plain "something changed, re-fetch
  // getActors()" signal only wired up during the lobby phase), this identifies exactly which actor
  // left, for as long as its caller cares to listen (including during an active game) - wraps
  // whatever onActorLeave handler is already set (checkMasterChanged, in the constructor) the same
  // way onActorsChanged does, rather than replacing it outright.
  onActorLeft(listener: (actorNr: number) => void): () => void {
    const prev = this.client.onActorLeave
    this.client.onActorLeave = (actor, cleanup) => {
      prev?.(actor, cleanup)
      listener(actor.actorNr)
    }
    return () => {
      this.client.onActorLeave = prev
    }
  }

  disconnect(): void {
    this.client.disconnect()
  }
}
