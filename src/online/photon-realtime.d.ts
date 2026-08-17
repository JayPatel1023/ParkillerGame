// photon-realtime (v4.4.0) ships no TypeScript declarations of its own (confirmed - no .d.ts, no
// "types"/"typings" field in its package.json). This covers only the surface photonClient.ts
// actually calls, verified against the real shipped module source (photon-realtime-module.js),
// not the (bot-blocked, unreachable while writing this) official docs site - grep that file for
// the literal method/property name before trusting or extending any signature below.
declare module 'photon-realtime' {
  export const ConnectionProtocol: {
    Wss: number
  }

  /** The constructor shape PhotonPeer.setWebSocketImpl expects - the browser's native WebSocket
   * already satisfies this exactly, see photonClient.ts's own comment on why this is needed. */
  export const PhotonPeer: {
    setWebSocketImpl(impl: typeof WebSocket): void
  }

  export namespace LoadBalancing {
    interface RoomOptions {
      createIfNotExists?: boolean
      maxPlayers?: number
    }

    interface Actor {
      actorNr: number
      isLocal: boolean
      getCustomProperties(): Record<string, unknown>
      setCustomProperties(props: Record<string, unknown>): void
    }

    interface Room {
      masterClientId: number
      getCustomProperties(): Record<string, unknown>
      setCustomProperties(props: Record<string, unknown>): void
    }

    const Constants: {
      ReceiverGroup: {
        Others: number
        All: number
        MasterClient: number
      }
      OperationCode: {
        JoinGame: number
        CreateGame: number
      }
      ErrorCode: {
        Ok: number
        GameDoesNotExist: number
        GameFull: number
        GameClosed: number
        GameIdAlreadyExists: number
      }
    }

    class LoadBalancingClient {
      static State: {
        Error: number
        Uninitialized: number
        ConnectingToNameServer: number
        ConnectedToNameServer: number
        ConnectingToMaster: number
        ConnectedToMaster: number
        JoinedLobby: number
        ConnectingToGameserver: number
        Joined: number
        Disconnected: number
      }
      static StateToName(state: number): string

      constructor(protocol: number, appId: string, appVersion: string)

      onStateChange: (state: number) => void
      onEvent: (code: number, content: unknown, actorNr: number) => void
      onActorJoin: (actor: Actor) => void
      onActorLeave: (actor: Actor, cleanup: boolean) => void
      /** Fires when an actor's custom properties change *after* they've already joined (e.g. a
       * seat-color claim sent right after joinRoom() resolves) - a separate event from
       * onActorJoin, which only fires once for the join itself. See photonClient.ts's own
       * onActorsChanged for why both are needed. */
      onActorPropertiesChange: (actor: Actor) => void
      /** Fires for operation-level failures (bad room code, full room, ...) that never touch
       * onStateChange at all - see photonClient.ts's own comment on joinOrCreate for why both are
       * needed. errorCode 0 (ErrorCode.Ok) means success. */
      onOperationResponse: (errorCode: number, errorMsg: string, operationCode: number, vals: unknown) => void

      state(): number
      isInLobby(): boolean
      isJoinedToRoom(): boolean
      connectToRegionMaster(region: string): void
      disconnect(): void
      joinRoom(roomName: string, joinOptions?: RoomOptions, createOptions?: RoomOptions): void
      raiseEvent(code: number, data: unknown, options?: { receivers?: number }): void
      myActor(): Actor
      myRoom(): Room
      myRoomMasterActorNr(): number
      myRoomActorsArray(): Actor[]
    }
  }
}
