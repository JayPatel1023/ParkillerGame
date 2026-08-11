import type { RoomTransport } from '../../src/online/roomTransport'

/**
 * A minimal in-memory RoomTransport network for testing HostTurnManagerBridge/RemoteTurnManager
 * convergence without a real Photon connection - every send is a direct, synchronous function
 * call (no real network latency/async), which is exactly what makes these tests fast and
 * deterministic while still exercising the real message-passing code paths.
 */
export class FakeRoomNetwork {
  private readonly actors = new Map<number, FakeRoomTransport>()
  masterActorNr: number

  constructor(masterActorNr: number) {
    this.masterActorNr = masterActorNr
  }

  createTransport(actorNr: number): FakeRoomTransport {
    const transport = new FakeRoomTransport(actorNr, this)
    this.actors.set(actorNr, transport)
    return transport
  }

  deliverToMaster(data: unknown, senderActorNr: number): void {
    this.actors.get(this.masterActorNr)?.receive(data, senderActorNr)
  }

  broadcastFrom(data: unknown, senderActorNr: number): void {
    for (const transport of this.actors.values()) transport.receive(data, senderActorNr)
  }
}

class FakeRoomTransport implements RoomTransport {
  private messageListeners: Array<(data: unknown, senderActorNr: number) => void> = []
  private masterChangeListeners: Array<() => void> = []

  constructor(
    public readonly localActorNr: number,
    private readonly network: FakeRoomNetwork,
  ) {}

  isMasterClient(): boolean {
    return this.localActorNr === this.network.masterActorNr
  }

  sendToMaster(data: unknown): void {
    this.network.deliverToMaster(data, this.localActorNr)
  }

  broadcast(data: unknown): void {
    this.network.broadcastFrom(data, this.localActorNr)
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

  receive(data: unknown, senderActorNr: number): void {
    for (const listener of this.messageListeners) listener(data, senderActorNr)
  }
}
