// photon-realtime (v4.4.0) ships no TypeScript declarations of its own (confirmed - no .d.ts, no
// "types"/"typings" field in its package.json). This covers only the surface photonClient.ts
// actually calls, verified against the real shipped module source (photon-realtime-module.js),
// not the (bot-blocked, unreachable while writing this) official docs site - grep that file for
// the literal method/property name before trusting or extending any signature below.
declare module 'photon-realtime' {
  export const ConnectionProtocol: {
    Wss: number
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

      state(): number
      isInLobby(): boolean
      isJoinedToRoom(): boolean
      connectToRegionMaster(region: string): void
      disconnect(): void
      joinRoom(roomName: string, options?: RoomOptions): void
      raiseEvent(code: number, data: unknown, options?: { receivers?: number }): void
      myActor(): Actor
      myRoom(): Room
      myRoomMasterActorNr(): number
      myRoomActorsArray(): Actor[]
    }
  }
}
