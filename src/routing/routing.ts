// src/routing/routing.ts
// RFC-0007, Sections 2, 4, and 5, RFC-0009 Section 6, RFC-0006
// Section 4's emergency broadcast, and RFC-0006 Section 5
// fragmentation, now wired into the actual send path.
//
// Every outbound send in RelayNode routes through one choke point,
// sendEnvelopeOverTransport, which checks the destination's real MTU
// and transparently fragments anything that doesn't fit, rather than
// letting transport.send() silently fail the way it did before this.
// That silent failure was the root cause of the ratchet desync bug
// found during Phase 7's file chunking test.
//
// Known limitation, not hidden: fragmented sends aren't atomic. If
// one fragment fails to send partway through, the receiver is left
// with a permanently incomplete set, cleaned up eventually by
// FragmentReassembler.purgeStale() rather than ever completing.

import { sha256 } from '@noble/hashes/sha2.js';
import { Encoder } from 'cbor-x';
import { signMessage, verifySignature } from '../crypto/keys';
import type { Identity } from '../identity/identity';
import {
  type Envelope,
  PacketType,
  validateRoutingHeader,
  encodeEnvelope,
  decodeEnvelope,
  createSyncEnvelope,
  createBroadcastEnvelope,
} from '../envelope/envelope';
import { fragmentEnvelope, FragmentReassembler } from '../envelope/fragment';
import { concatBytes, bytesEqual, bytesToHex, u64le } from '../util';
import { StoreForwardQueue } from '../storage/store';
import type { Transport } from '../transport/transport';
import {
  type BroadcastMessage,
  createBroadcastMessage,
  verifyBroadcastMessage,
  encodeBroadcastMessage,
  decodeBroadcastMessage,
} from '../broadcast/broadcast';

const cbor = new Encoder();

const ROUTING_AD_CONTEXT = 'ZAYCOMM_ROUTING_AD_V1';
const DESTINATION_HINT_LENGTH = 8;
const DEFAULT_BROADCAST_TTL = 8;

const FRAME_KIND_ENVELOPE = 0;
const FRAME_KIND_FRAGMENT = 1;

export function computeDestinationHint(publicKey: Uint8Array): Uint8Array {
  return sha256(publicKey).slice(0, DESTINATION_HINT_LENGTH);
}

export interface RoutingAdvertisement {
  advertiserPublicKey: Uint8Array;
  reachableDestinations: Uint8Array[];
  timestamp: number;
  signature: Uint8Array;
}

function buildAdvertisementMessage(reachableDestinations: Uint8Array[], timestamp: number): Uint8Array {
  const context = new TextEncoder().encode(ROUTING_AD_CONTEXT);
  return concatBytes(context, u64le(timestamp), ...reachableDestinations);
}

export function createRoutingAdvertisement(
  identity: Identity,
  reachableDestinations: Uint8Array[]
): RoutingAdvertisement {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = buildAdvertisementMessage(reachableDestinations, timestamp);
  const signature = signMessage(message, identity.privateKey);
  return { advertiserPublicKey: identity.publicKey, reachableDestinations, timestamp, signature };
}

export function verifyRoutingAdvertisement(ad: RoutingAdvertisement): boolean {
  const message = buildAdvertisementMessage(ad.reachableDestinations, ad.timestamp);
  return verifySignature(ad.signature, message, ad.advertiserPublicKey);
}

class RoutingTable {
  private routes = new Map<string, string>();

  learnFromAdvertisement(fromNeighborId: string, ad: RoutingAdvertisement): void {
    if (!verifyRoutingAdvertisement(ad)) return;
    for (const hint of ad.reachableDestinations) {
      this.routes.set(bytesToHex(hint), fromNeighborId);
    }
  }

  lookup(destinationHint: Uint8Array): string | null {
    return this.routes.get(bytesToHex(destinationHint)) ?? null;
  }

  hasRoute(destinationHint: Uint8Array): boolean {
    return this.routes.has(bytesToHex(destinationHint));
  }
}

export type DeliveryResult =
  | { outcome: 'delivered'; envelope: Envelope }
  | { outcome: 'forwarded'; to: string }
  | { outcome: 'queued' }
  | { outcome: 'broadcast'; message: BroadcastMessage }
  | { outcome: 'dropped'; reason: string };

type SyncSummaryEntry = [Uint8Array, number];
type SyncPayloadTuple = [0, SyncSummaryEntry[]] | [1, Uint8Array[]] | [2, Uint8Array[]];

export class RelayNode {
  readonly id: string;
  readonly identity: Identity;
  readonly transport: Transport;
  private readonly routingTable = new RoutingTable();
  private readonly queue = new StoreForwardQueue();
  private readonly reassembler = new FragmentReassembler();
  private readonly ownDestinationHint: Uint8Array;
  private deliveryListeners: ((envelope: Envelope) => void)[] = [];
  private broadcastListeners: ((message: BroadcastMessage) => void)[] = [];
  private seenBroadcasts = new Map<string, number>();

  constructor(id: string, identity: Identity, transport: Transport) {
    this.id = id;
    this.identity = identity;
    this.transport = transport;
    this.ownDestinationHint = computeDestinationHint(identity.publicKey);
    this.transport.onReceive((fromNeighborId, frame) => {
      if (frame.length === 0) return;
      const kind = frame[0];
      const body = frame.slice(1);

      if (kind === FRAME_KIND_FRAGMENT) {
        const reassembled = this.reassembler.addFragment(body);
        if (reassembled) {
          this.receiveEnvelope(reassembled, fromNeighborId);
        }
        return;
      }

      const envelope = decodeEnvelope(body);
      this.receiveEnvelope(envelope, fromNeighborId);
    });
  }

  onDelivered(listener: (envelope: Envelope) => void): void {
    this.deliveryListeners.push(listener);
  }

  onBroadcastReceived(listener: (message: BroadcastMessage) => void): void {
    this.broadcastListeners.push(listener);
  }

  hasRoute(destinationHint: Uint8Array): boolean {
    return this.routingTable.hasRoute(destinationHint);
  }

  queueSize(): number {
    return this.queue.size();
  }

  purgeStaleBroadcastRecords(maxAgeMs: number): number {
    const now = Date.now();
    let purged = 0;
    for (const [key, seenAt] of this.seenBroadcasts) {
      if (now - seenAt > maxAgeMs) {
        this.seenBroadcasts.delete(key);
        purged++;
      }
    }
    return purged;
  }

  purgeStaleFragments(maxAgeMs: number): number {
    return this.reassembler.purgeStale(maxAgeMs);
  }

  /**
   * The single choke point for every outbound send. Checks the
   * destination's real MTU (RFC-0008 Section 1) and transparently
   * fragments (RFC-0006 Section 5) anything that doesn't fit, rather
   * than letting a raw transport.send() silently fail.
   */
  private sendEnvelopeOverTransport(neighborId: string, envelope: Envelope): boolean {
    const characteristics = this.transport.getLinkCharacteristics(neighborId);
    const mtu = characteristics?.maxTransmissionUnit ?? Infinity;
    const encoded = encodeEnvelope(envelope);

    if (encoded.length + 1 <= mtu) {
      return this.transport.send(neighborId, concatBytes(new Uint8Array([FRAME_KIND_ENVELOPE]), encoded));
    }

    const fragments = fragmentEnvelope(envelope, mtu - 1);
    let allSent = true;
    for (const fragment of fragments) {
      const sent = this.transport.send(neighborId, concatBytes(new Uint8Array([FRAME_KIND_FRAGMENT]), fragment));
      if (!sent) allSent = false;
    }
    return allSent;
  }

  broadcast(content: Uint8Array, ttl: number = DEFAULT_BROADCAST_TTL): void {
    const message = createBroadcastMessage(this.identity, content);
    const envelope = createBroadcastEnvelope(encodeBroadcastMessage(message), ttl);
    for (const neighborId of this.transport.discoverNeighbors()) {
      this.sendEnvelopeOverTransport(neighborId, envelope);
    }
  }

  receiveAdvertisement(fromNeighborId: string, ad: RoutingAdvertisement): void {
    this.routingTable.learnFromAdvertisement(fromNeighborId, ad);
    for (const hint of ad.reachableDestinations) {
      this.attemptQueuedDelivery(hint);
    }
  }

  private attemptQueuedDelivery(destinationHint: Uint8Array): void {
    const nextHopId = this.routingTable.lookup(destinationHint);
    if (!nextHopId) return;
    for (const envelope of this.queue.getByDestination(destinationHint)) {
      const sent = this.forwardOverTransport(envelope, nextHopId);
      if (sent) this.queue.acknowledge(envelope.header.messageId);
    }
  }

  private forwardOverTransport(envelope: Envelope, nextHopId: string): boolean {
    const forwardedEnvelope: Envelope = {
      header: { ...envelope.header, ttl: envelope.header.ttl - 1 },
      sealedPayload: envelope.sealedPayload,
    };
    return this.sendEnvelopeOverTransport(nextHopId, forwardedEnvelope);
  }

  initiateSync(neighborId: string): void {
    const entries: SyncSummaryEntry[] = this.queue.getSummary().map((e) => [e.messageId, e.ttlRemaining]);
    const tuple: SyncPayloadTuple = [0, entries];
    const summaryEnvelope = createSyncEnvelope(Uint8Array.from(cbor.encode(tuple)));
    this.sendEnvelopeOverTransport(neighborId, summaryEnvelope);
  }

  private handleSyncPacket(envelope: Envelope, fromNodeId: string | null): DeliveryResult {
    if (!fromNodeId) {
      return { outcome: 'dropped', reason: 'sync packet with no sender' };
    }

    const tuple = cbor.decode(envelope.sealedPayload) as SyncPayloadTuple;

    if (tuple[0] === 0) {
      const entries: SyncSummaryEntry[] = tuple[1].map(([id, ttl]) => [Uint8Array.from(id), ttl]);
      const missingIds = entries.filter(([id]) => !this.queue.has(id)).map(([id]) => id);
      if (missingIds.length > 0) {
        const requestTuple: SyncPayloadTuple = [1, missingIds];
        const requestEnvelope = createSyncEnvelope(Uint8Array.from(cbor.encode(requestTuple)));
        this.sendEnvelopeOverTransport(fromNodeId, requestEnvelope);
      }
      return { outcome: 'delivered', envelope };
    }

    if (tuple[0] === 1) {
      const requestedIds = tuple[1].map((id) => Uint8Array.from(id));
      const requested = this.queue.getByIds(requestedIds);
      const wireEnvelopes = requested.map((e) => Uint8Array.from(encodeEnvelope(e)));
      const transferTuple: SyncPayloadTuple = [2, wireEnvelopes];
      const transferEnvelope = createSyncEnvelope(Uint8Array.from(cbor.encode(transferTuple)));
      this.sendEnvelopeOverTransport(fromNodeId, transferEnvelope);
      return { outcome: 'delivered', envelope };
    }

    for (const wireBytes of tuple[1]) {
      const syncedEnvelope = decodeEnvelope(Uint8Array.from(wireBytes));
      this.receiveEnvelope(syncedEnvelope, fromNodeId);
    }
    return { outcome: 'delivered', envelope };
  }

  private handleBroadcastPacket(envelope: Envelope, fromNodeId: string | null): DeliveryResult {
    const key = bytesToHex(envelope.header.messageId);
    if (this.seenBroadcasts.has(key)) {
      return { outcome: 'dropped', reason: 'broadcast already seen' };
    }
    this.seenBroadcasts.set(key, Date.now());

    const message = decodeBroadcastMessage(envelope.sealedPayload);
    if (!verifyBroadcastMessage(message)) {
      return { outcome: 'dropped', reason: 'invalid broadcast signature' };
    }

    for (const listener of this.broadcastListeners) listener(message);

    if (envelope.header.ttl > 0) {
      const forwarded: Envelope = {
        header: { ...envelope.header, ttl: envelope.header.ttl - 1 },
        sealedPayload: envelope.sealedPayload,
      };
      for (const neighborId of this.transport.discoverNeighbors()) {
        if (neighborId !== fromNodeId) {
          this.sendEnvelopeOverTransport(neighborId, forwarded);
        }
      }
    }

    return { outcome: 'broadcast', message };
  }

  receiveEnvelope(envelope: Envelope, fromNodeId: string | null): DeliveryResult {
    if (!validateRoutingHeader(envelope.header)) {
      return { outcome: 'dropped', reason: 'invalid header' };
    }

    if (envelope.header.packetType === PacketType.StoreForwardSync) {
      return this.handleSyncPacket(envelope, fromNodeId);
    }

    if (envelope.header.packetType === PacketType.EmergencyBroadcast) {
      return this.handleBroadcastPacket(envelope, fromNodeId);
    }

    if (bytesEqual(envelope.header.destinationHint, this.ownDestinationHint)) {
      for (const listener of this.deliveryListeners) listener(envelope);
      return { outcome: 'delivered', envelope };
    }

    if (envelope.header.ttl <= 0) {
      return { outcome: 'dropped', reason: 'ttl expired' };
    }

    const nextHopId = this.routingTable.lookup(envelope.header.destinationHint);
    if (nextHopId) {
      const sent = this.forwardOverTransport(envelope, nextHopId);
      if (sent) return { outcome: 'forwarded', to: nextHopId };
    }

    const result = this.queue.store(envelope, fromNodeId ?? 'origin');
    if (result.stored) {
      return { outcome: 'queued' };
    }
    return { outcome: 'dropped', reason: result.reason ?? 'unknown' };
  }
}
