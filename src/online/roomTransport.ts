/**
 * The only networking surface HostTurnManagerBridge/RemoteTurnManager actually depend on -
 * deliberately not the Photon SDK's own shape, so those two classes can be unit-tested against a
 * tiny in-memory fake (see tests/online/fakeRoomTransport.ts) without a real Photon connection,
 * and so swapping the underlying service later wouldn't touch bridge code at all.
 */
export interface RoomTransport {
  /** This client's own actor number in the room - stable for the room's lifetime. */
  readonly localActorNr: number
  /** Whether this client is currently the room's authoritative peer. Can change mid-game if the
   * previous Master Client disconnects - see onMasterClientChanged. */
  isMasterClient(): boolean
  /** Delivered only to whoever is currently Master (routed server-side - the sender doesn't need
   * to know who that is). Non-master clients use this to send an action intent. */
  sendToMaster(data: unknown): void
  /** Delivered to every actor in the room, including the sender. The Master Client uses this to
   * broadcast an authoritative result. */
  broadcast(data: unknown): void
  /** Fires for every message this actor receives, from sendToMaster or broadcast alike - callers
   * distinguish by the message's own `type` field, not by which method delivered it. */
  onMessage(listener: (data: unknown, senderActorNr: number) => void): () => void
  /** Fires when the room's Master Client changes (including this client becoming Master because
   * the previous one disconnected) - callers should re-check isMasterClient() when this fires,
   * not cache the answer. */
  onMasterClientChanged(listener: () => void): () => void
}
